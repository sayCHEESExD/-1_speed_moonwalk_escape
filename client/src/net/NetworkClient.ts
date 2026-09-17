import {
  MessageType,
  ROOM_NAME,
  type AvatarLook,
  type AvatarLookMessage,
  type BloxityIdentityMessage,
  type SetIdentityMessage,
  type BuyUpgradeMessage,
  type ClaimStageMessage,
  type MoveMessage,
  type RequestRespawnMessage,
  type RespawnMessage,
  type StageAwardedMessage,
} from '@moonwalk/shared';
import { Client, getStateCallbacks, type Room } from 'colyseus.js';
import { clientConfig } from '../config/clientConfig.js';
import { logger } from '../util/logger.js';
import type {
  ConnectionStatus,
  LeaderboardSnapshot,
  NetCourseState,
  NetLeaderEntry,
  NetPlayerState,
} from './netTypes.js';

const SCOPE = 'NetworkClient';

/** Key under which this browser's stable player id is kept. */
const PLAYER_ID_KEY = 'moonwalkescape.playerId';

/**
 * Backoff between join attempts, in milliseconds. One entry per RETRY.
 *
 * A free managed host suspends an idle service and takes the better part of a
 * minute to wake it, so the first visitor after a quiet spell always meets a
 * server that is not listening yet. A single attempt turns that into a session
 * that is permanently offline - it renders and it moves, so it looks healthy,
 * but nothing is server-authoritative and therefore nothing progresses. These
 * retries turn a cold start into a slow start instead.
 */
const JOIN_BACKOFF_MS = [1000, 2000, 4000, 8000, 15000] as const;

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

/**
 * A stable id for this browser, so progression survives a reload.
 *
 * Falls back to a throwaway id when storage is unavailable (private windows,
 * blocked site data) - the session still works, it just will not be restored.
 */
const resolvePlayerId = (): string => {
  const fresh = `p_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
  try {
    const existing = window.localStorage.getItem(PLAYER_ID_KEY);
    if (existing) return existing;
    window.localStorage.setItem(PLAYER_ID_KEY, fresh);
  } catch {
    return fresh;
  }
  return fresh;
};

/** Everything the game needs to react to. Kept deliberately small. */
export interface NetworkHandlers {
  onStatusChange?(status: ConnectionStatus, detail?: string): void;
  onSelfJoined?(sessionId: string): void;
  onPlayerAdded?(sessionId: string, player: NetPlayerState): void;
  onPlayerChanged?(sessionId: string, player: NetPlayerState): void;
  onPlayerRemoved?(sessionId: string): void;
  onRespawn?(message: RespawnMessage): void;
  onStageAwarded?(message: StageAwardedMessage): void;
}

/**
 * Thin wrapper over colyseus.js.
 *
 * The rest of the client never imports colyseus.js directly - swapping the
 * transport or the room name only touches this file and @moonwalk/shared.
 */
export class NetworkClient {
  private readonly handlers: NetworkHandlers;

  /**
   * Built on CONNECT, not on construction.
   *
   * Colyseus parses the endpoint in its own constructor, so building this
   * eagerly meant a build with no server configured threw while the `Game` was
   * still being assembled - long before anything could report why. The whole
   * game then failed to start with "Invalid URL", which says nothing at all
   * about the actual cause: nobody set `VITE_SERVER_URL`.
   */
  private client: Client | null = null;

  private room: Room<NetCourseState> | null = null;

  /**
   * Where the join gets the Bloxity token from. A callback rather than a stored
   * value, so a logout between two joins can never send the previous token.
   */
  private identity: (() => string | null) | null = null;
  /** The local player's appearance, re-sent on every (re)join. */
  private look: AvatarLook | null = null;
  /** The local player's portal identity, re-sent on every (re)join. */
  private identityMessage: SetIdentityMessage | null = null;
  private status: ConnectionStatus = 'idle';

  constructor(handlers: NetworkHandlers = {}) {
    this.handlers = handlers;
  }

  /** Where to read the Bloxity token at join time. */
  setIdentityProvider(provider: () => string | null): void {
    this.identity = provider;
  }

  /**
   * Tell the room about a login or logout that happened after joining.
   *
   * The TOKEN, which the server verifies with Bloxity. It decides one thing
   * only - which account a Bux purchase is granted to - and is never what
   * anybody is named by.
   */
  sendBloxityToken(token: string | null): void {
    const message: BloxityIdentityMessage = { token: token ?? '' };
    this.room?.send(MessageType.BloxityIdentity, message);
  }

  /**
   * Tell the room who the portal says this player is.
   *
   * Remembered, and re-sent on the next join: an identity that arrived while
   * the socket was down would otherwise leave this player nameless to
   * everybody else until their next portal event.
   */
  sendIdentity(identity: SetIdentityMessage): void {
    this.identityMessage = identity;
    this.room?.send(MessageType.SetIdentity, identity);
  }

  /**
   * Tell the room what this player's character looks like.
   *
   * Remembered, and re-sent on the next join: a look that arrived while the
   * socket was down would otherwise leave this player as the bundled
   * character to everybody else until they next touched the customiser.
   */
  sendAvatarLook(look: AvatarLook): void {
    this.look = look;
    this.room?.send(MessageType.AvatarLook, look satisfies AvatarLookMessage);
  }

  get sessionId(): string | null {
    return this.room?.sessionId ?? null;
  }

  /**
   * The Colyseus room id, or '' when not in one.
   *
   * A string rather than the room itself: the room object is this class's
   * business and nothing outside `net/` should be able to send on it.
   */
  get roomId(): string {
    return this.room?.roomId ?? '';
  }

  get connectionStatus(): ConnectionStatus {
    return this.status;
  }

  /**
   * The server's clock, in seconds.
   *
   * Every disco ball is a pure function of it, so this is what the client
   * evaluates `hazardPositionAt` against - which is why the ball on screen is
   * in the same place as the one the server will kill you with.
   */
  get elapsed(): number {
    return this.room?.state?.elapsed ?? 0;
  }

  async connect(): Promise<void> {
    // No endpoint is a CONFIGURATION fault, not a network one, and it is
    // reported as one before a socket is ever attempted. On a static host this
    // is far and away the likeliest thing to be wrong.
    if (!clientConfig.serverUrl) {
      this.setStatus('error');
      throw new Error(
        'No game server is configured. Set VITE_SERVER_URL to the Colyseus ' +
          'endpoint (for example wss://your-server-host) and rebuild.',
      );
    }

    this.setStatus('connecting');
    logger.info(SCOPE, `joining "${ROOM_NAME}" at ${clientConfig.serverUrl}`);

    this.client ??= new Client(clientConfig.serverUrl);
    const playerId = resolvePlayerId();
    const attempts = JOIN_BACKOFF_MS.length + 1;

    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      try {
        this.room = await this.client.joinOrCreate<NetCourseState>(ROOM_NAME, {
          playerId,
          // Optional. Verified by the server with Bloxity, never trusted as-is.
          bloxityToken: this.identity?.() ?? undefined,
          // Who the portal says this is, so a player has their name from the
          // first patch rather than from their next portal event.
          identity: this.identityMessage ?? undefined,
        });
        // Whatever this player looks like, said again on the new socket.
        if (this.look) this.room.send(MessageType.AvatarLook, this.look satisfies AvatarLookMessage);
        if (this.identityMessage) this.room.send(MessageType.SetIdentity, this.identityMessage);
        break;
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        logger.warn(SCOPE, `join attempt ${attempt}/${attempts} failed: ${detail}`);

        if (attempt === attempts) {
          this.setStatus('error', detail);
          logger.error(SCOPE, 'join failed:', detail);
          throw error;
        }

        // Kept in 'connecting' with the attempt as the detail, so the status
        // listener sees a wake-up in progress rather than a dead connection.
        this.setStatus('connecting', `attempt ${attempt + 1}/${attempts}`);
        await sleep(JOIN_BACKOFF_MS[attempt - 1] ?? 0);
      }
    }

    if (!this.room) throw new Error('join produced no room');

    this.bindRoom(this.room);
    this.setStatus('connected');
    logger.info(
      SCOPE,
      `joined roomId=${this.room.roomId} sessionId=${this.room.sessionId}`,
    );
    this.handlers.onSelfJoined?.(this.room.sessionId);
  }

  /**
   * Report one simulated input.
   *
   * Deliberately NOT rate limited. The client simulates on a fixed 60Hz step
   * and the server advances only by the inputs it receives, so throttling here
   * would leave the authoritative position permanently behind the player. The
   * message is seven small fields.
   */
  sendInput(message: MoveMessage): void {
    this.room?.send(MessageType.Move, message);
  }

  /** Ask the server to bank a stage. The server decides; this never grants. */
  claimStage(stageIndex: number): void {
    const message: ClaimStageMessage = { stageIndex };
    this.room?.send(MessageType.ClaimStage, message);
  }

  /** Ask to buy a speed tile. The server takes the payment. */
  buyUpgrade(slot: number): void {
    const message: BuyUpgradeMessage = { slot };
    this.room?.send(MessageType.BuyUpgrade, message);
  }

  /**
   * Ask to rebirth.
   *
   * Carries nothing: the server knows the level and the rebirth count and is
   * the only thing allowed to decide whether the requirement is met.
   */
  requestRebirth(): void {
    this.room?.send(MessageType.Rebirth, {});
  }

  /**
   * The three leaderboards, as plain arrays.
   *
   * COPIED out of the schema rather than handed over live. A live schema
   * reference reads as whatever it holds at the moment it is looked at, so a
   * renderer that kept one would silently start showing a later board than the
   * one it decided to redraw for - which is exactly the class of bug that
   * makes a display look like it is missing updates.
   */
  get leaderboard(): LeaderboardSnapshot | null {
    const board = this.room?.state?.leaderboard;
    if (!board) return null;
    const copy = (rows: ArrayLike<NetLeaderEntry>): NetLeaderEntry[] => {
      const out: NetLeaderEntry[] = [];
      for (let i = 0; i < rows.length; i += 1) {
        const row = rows[i];
        if (row) out.push({ name: row.name, avatar: row.avatar, value: row.value });
      }
      return out;
    };
    return { wins: copy(board.wins), speed: copy(board.speed), rebirths: copy(board.rebirths) };
  }

  /**
   * Ask to be put back at the arena.
   *
   * The server decides where a respawn lands and replies with the
   * authoritative `Respawn`, so this can no more move a player than a stage
   * claim can pay one. The reason is carried for the LOG only - it is what
   * makes "the guard got me" and "I fell" distinguishable afterwards, and it
   * never changes the destination.
   */
  requestRespawn(reason: RequestRespawnMessage['reason'] = 'manual'): void {
    const message: RequestRespawnMessage = { reason };
    this.room?.send(MessageType.RequestRespawn, message);
  }

  async disconnect(): Promise<void> {
    await this.room?.leave(true);
    this.room = null;
    this.setStatus('disconnected');
  }

  private bindRoom(room: Room<NetCourseState>): void {
    const $ = getStateCallbacks(room);

    $(room.state).players.onAdd((player, sessionId) => {
      this.handlers.onPlayerAdded?.(sessionId, player);
      $(player).onChange(() => {
        this.handlers.onPlayerChanged?.(sessionId, player);
      });
      /*
       * And SEPARATELY on the avatar.
       *
       * `onChange` on a schema fires for that schema's OWN fields, not for a
       * nested one: a player who changed their hat and nothing else produced a
       * patch the handler above never heard about, so a remote character kept
       * whatever it was wearing when it joined. The same handler is called,
       * because the game reads the whole player state either way.
       */
      $(player).avatar.onChange(() => {
        this.handlers.onPlayerChanged?.(sessionId, player);
      });
    });

    $(room.state).players.onRemove((_player, sessionId) => {
      this.handlers.onPlayerRemoved?.(sessionId);
    });

    room.onMessage<RespawnMessage>(MessageType.Respawn, (message) => {
      this.handlers.onRespawn?.(message);
    });

    room.onMessage<StageAwardedMessage>(MessageType.StageAwarded, (message) => {
      this.handlers.onStageAwarded?.(message);
    });

    room.onError((code, message) => {
      logger.error(SCOPE, `room error ${code}: ${message ?? ''}`);
      this.setStatus('error', message);
    });

    room.onLeave((code) => {
      logger.warn(SCOPE, `left room (code ${code})`);
      this.setStatus('disconnected', `code ${code}`);
    });
  }

  private setStatus(status: ConnectionStatus, detail?: string): void {
    this.status = status;
    this.handlers.onStatusChange?.(status, detail);
  }
}
