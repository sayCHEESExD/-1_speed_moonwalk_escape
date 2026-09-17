import {
  MessageType,
  ROOM_NAME,
  type AvatarLook,
  type AvatarLookMessage,
  PROTOCOL_SET_IDENTITY,
  PROTOCOL_VERSION,
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
  /** Where the join reads the portal identity from, live. */
  private profile: (() => SetIdentityMessage | null) | null = null;
  /** The protocol the joined room declares. 0 until its first patch says. */
  private serverProtocol = 0;
  /** So the "older server" complaint is made once per session, not per join. */
  private checkedFields = false;
  private status: ConnectionStatus = 'idle';

  constructor(handlers: NetworkHandlers = {}) {
    this.handlers = handlers;
  }

  /** Where to read the Bloxity token at join time. */
  setIdentityProvider(provider: () => string | null): void {
    this.identity = provider;
  }

  /**
   * Where to read the portal identity at JOIN time.
   *
   * A provider rather than the last message sent, because the two are not the
   * same thing: the SDK resolves a signed-in user with a round trip of its own
   * (`init` fetches the profile, then notifies), so a join that happens in that
   * window would otherwise carry nothing and the player would sit as a guest
   * until their next portal event. Asking at the moment of joining closes that
   * window - the proven arrangement from the previous game in this series.
   */
  setProfileProvider(provider: () => SetIdentityMessage | null): void {
    this.profile = provider;
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
    // Never to a server that does not know the message: it would answer by
    // closing the connection. The join options carry the same identity, and an
    // older server ignores an option it does not read.
    // Held back until the room has declared a protocol that can hear it. The
    // moment it does, `watchProtocol` sends what was stored here.
    if (this.serverProtocol < PROTOCOL_SET_IDENTITY) return;
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
   * Whether there is a room to defer to at all.
   *
   * The one question the rest of the game has to be able to ask before waiting
   * on the server for something: a death waiting for a placement that can
   * never arrive is a frozen player, and this game deliberately keeps running
   * with no server.
   */
  /**
   * Watch the protocol the joined room declares, and say so when it is old.
   *
   * This exists because of an outage that cost days to find: Colyseus answers
   * a message with NO REGISTERED HANDLER by closing the connection (4002). A
   * client one deploy ahead of its server therefore joins, says hello, and is
   * thrown straight back out - and because every reward is server-granted, the
   * symptom is not "a network error" but "everyone is called Guest and nobody
   * can level up".
   *
   * Read off the STATE rather than from `/health`: the two halves are served
   * from different hosts, so a browser blocks that request before the server
   * ever sees it. A room with no `protocol` field is an older server, which is
   * the whole point.
   */
  private watchProtocol(room: Room<NetCourseState>, $: ReturnType<typeof getStateCallbacks>): void {
    this.serverProtocol = 0;
    /*
     * WATCHED, not sampled. The room is bound the instant the join resolves,
     * and the first state patch has not arrived yet - reading the field there
     * finds nothing and would condemn a perfectly current server to the old
     * path for the whole session.
     *
     * A server too old to have the field never fires this, which is exactly
     * how it is recognised.
     */
    $(room.state).listen('protocol', (value?: number) => {
      const declared = typeof value === 'number' && value > 0 ? value : 0;
      if (declared <= this.serverProtocol) return;
      this.serverProtocol = declared;
      // Anything held back until the contract was known can go now.
      if (declared >= PROTOCOL_SET_IDENTITY && this.identityMessage && this.room) {
        this.room.send(MessageType.SetIdentity, this.identityMessage);
      }
    });

    // Long enough for the first patch; short enough to be in the log beside
    // the join it belongs to.
    window.setTimeout(() => {
      if (this.room !== room || this.serverProtocol >= PROTOCOL_SET_IDENTITY) return;
      logger.error(
        SCOPE,
        `this client speaks protocol ${PROTOCOL_VERSION} and the game server ` +
          'declares none, so it is an OLDER BUILD than the client. Player names ' +
          'will show as guests until the SERVER is redeployed. Everything else ' +
          'still works - the identity message is held back rather than sent, ' +
          'because sending it makes that server close the connection, and a ' +
          'player who is not in a room can never earn anything at all.',
      );
    }, 4000);
  }

  /** What the joined room said it was, for diagnostics. */
  get build(): { protocol: number } {
    return { protocol: this.serverProtocol };
  }

  /** One player's replicated state, for diagnostics. */
  playerState(sessionId: string): NetPlayerState | undefined {
    return this.room?.state?.players?.get(sessionId);
  }

  get inRoom(): boolean {
    return this.room !== null;
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
          // Who the portal says this is, ASKED FOR NOW rather than taken from
          // whatever was last sent, so a login that landed mid-connect still
          // travels with the join.
          identity: this.profile?.() ?? this.identityMessage ?? undefined,
        });
        // Whatever this player looks like, said again on the new socket.
        if (this.look) this.room.send(MessageType.AvatarLook, this.look satisfies AvatarLookMessage);
        if (this.identityMessage && this.serverProtocol >= PROTOCOL_SET_IDENTITY) {
          this.room.send(MessageType.SetIdentity, this.identityMessage);
        }
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
    this.watchProtocol(room, $);

    $(room.state).players.onAdd((player, sessionId) => {
      if (sessionId === room.sessionId) this.checkServerFields(player);
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
      // Only if THIS room is still the current one. A late close from a
      // superseded socket must not null out a live room.
      if (this.room === room) this.room = null;
      this.setStatus('disconnected', `code ${code}`);
      /*
       * NO AUTOMATIC REJOIN, and that is a rule rather than an omission.
       *
       * A rejoin looks harmless and is not: every join PLACES the player at
       * the arena, so a socket that flaps - or a late `onLeave` from a
       * superseded room - turns into a player who is teleported to spawn over
       * and over while perfectly alive. That shipped once and made the game
       * unplayable. Reconnecting is the player's call, by reloading, and the
       * offline notice tells them so.
       */
    });
  }

  /**
   * Complain, ONCE and loudly, if the room cannot carry what this client sends.
   *
   * The same failure the scoreboard learned to report: a deployed server older
   * than the deployed client has no `displayName` and no `avatar` on its
   * player state, so every name silently falls back to Guest and every
   * character to the bundled one - with the game otherwise working perfectly,
   * which is what makes it so hard to place. It is a deployment fault and the
   * operator is the only one who can fix it, so it says exactly that.
   */
  private checkServerFields(player: NetPlayerState): void {
    if (this.checkedFields) return;
    this.checkedFields = true;
    const missing: string[] = [];
    if (!('displayName' in player)) missing.push('displayName');
    if (!('avatar' in player)) missing.push('avatar');
    if (missing.length === 0) return;
    logger.error(
      SCOPE,
      `the game server is running an OLDER build than this client: its player ` +
        `state has no ${missing.join(' or ')}. Every player will show as a ` +
        `guest wearing the bundled character until the server is redeployed.`,
    );
  }

  private setStatus(status: ConnectionStatus, detail?: string): void {
    this.status = status;
    this.handlers.onStatusChange?.(status, detail);
  }
}
