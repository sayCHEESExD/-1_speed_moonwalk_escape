import { Client, Room, ServerError } from '@colyseus/core';
import {
  MAX_PLAYERS_PER_ROOM,
  MessageType,
  PlayerAnimationState,
  sanitiseDisplayName,
  sanitisePfpUrl,
  SPAWN_POSITION,
  SPAWN_ROTATION_Y,
  type AvatarLookMessage,
  type BloxityIdentityMessage,
  type SetIdentityMessage,
  type BuyUpgradeMessage,
  type ClaimStageMessage,
  type MoveMessage,
  type RequestRespawnMessage,
  type RespawnMessage,
  type RespawnReason,
  type StageAwardedMessage,
} from '@moonwalk/shared';
import { buxGrants } from '../bloxity/buxGrantsStore.js';
import { verifyBloxityToken } from '../bloxity/bloxityIdentity.js';
import { serverConfig } from '../config/serverConfig.js';
import { MovementService } from '../movement/MovementService.js';
import { leaderboardService } from '../progression/LeaderboardService.js';
import { profileStore } from '../progression/ProfileStore.js';
import { RebirthService } from '../progression/RebirthService.js';
import { SpeedService } from '../progression/SpeedService.js';
import { StageService } from '../progression/StageService.js';
import { UpgradeService } from '../progression/UpgradeService.js';
import { wallet } from '../progression/Wallet.js';
import { logger } from '../util/logger.js';
import { CourseState } from './state/CourseState.js';
import { PlayerState } from './state/PlayerState.js';

const SCOPE = 'CourseRoom';

/** Seconds between autosaves of every connected player. */
const AUTOSAVE_SECONDS = 15;

/** Options a client may pass on join. Identity only. */
interface JoinOptions {
  playerId?: string;
  /** A Bloxity token, verified with Bloxity. Never an id. Used for Bux only. */
  bloxityToken?: string;
  /** Display name and portrait, as the portal reports them. */
  identity?: SetIdentityMessage;
}

/**
 * The authoritative room.
 *
 * Composition only: every rule lives in a service, and this decides the order
 * they run in. What it owns outright is the CLOCK - `state.elapsed` is what
 * every disco ball is a pure function of, so a hazard death is decided against
 * the server's own time and never against a client's.
 *
 * The one hard rule: nothing a client sends is ever copied into state. A Move
 * is simulated, a claim is validated, and both produce a result the server
 * writes itself.
 *
 * The GUARD is the one deliberate exception to server authority, and it is
 * carefully bounded. Each player's guard runs on that player's own machine
 * because no other player is allowed to see it, so nobody else's view can be
 * corrupted by it; and all it can ever do is ask to be sent back to the arena,
 * which is a request any client could already make and which costs the player
 * their run. There is nothing to gain by forging one.
 */
export class CourseRoom extends Room<CourseState> {
  /**
   * Capacity, and the matchmaker's cue to open another room.
   *
   * Colyseus locks a room the moment this is reached and `joinOrCreate` sends
   * the next player to a fresh one, so a full server routes rather than
   * refuses. The figure is shared with the client so the two can never hold
   * different ideas of how big a room is.
   */
  override maxClients = MAX_PLAYERS_PER_ROOM;

  private readonly movement = new MovementService();
  private readonly speeds = new SpeedService();
  private readonly stages = new StageService();
  private readonly upgrades = new UpgradeService();
  private readonly rebirths = new RebirthService();

  /** Browser-stored player id per session, for persistence. */
  private readonly playerIds = new Map<string, string>();

  /**
   * VERIFIED Bloxity account id per session, for Bux fulfilment.
   *
   * Only ever written from a token Bloxity itself resolved, so a grant can only
   * reach the account that paid for it.
   */
  private readonly bloxityIds = new Map<string, string>();

  /** Latest identity check per session, so a stale verification cannot win a race. */
  private readonly identityChecks = new Map<string, number>();

  private autosaveTimer = 0;

  override onCreate(): void {
    this.state = new CourseState();
    this.setPatchRate(serverConfig.patchRateMs);

    this.onMessage(MessageType.Move, (client, message: MoveMessage) =>
      this.onMove(client, message),
    );
    this.onMessage(MessageType.ClaimStage, (client, message: ClaimStageMessage) =>
      this.onClaimStage(client, message),
    );
    this.onMessage(MessageType.BuyUpgrade, (client, message: BuyUpgradeMessage) =>
      this.onBuyUpgrade(client, message),
    );
    this.onMessage(
      MessageType.RequestRespawn,
      (client, message: RequestRespawnMessage) =>
        // The guard says WHY, and the reason is logged and nothing else. Where
        // a player is placed is not a thing a client gets an opinion about.
        this.respawn(client, message?.reason === 'guard' ? 'guard' : 'manual'),
    );
    this.onMessage(MessageType.Rebirth, (client) => this.onRebirth(client));
    this.onMessage(MessageType.BloxityIdentity, (client, message: BloxityIdentityMessage) =>
      this.resolveIdentity(client.sessionId, typeof message?.token === 'string' ? message.token : ''),
    );
    /*
     * The one message whose contents are replicated rather than decided.
     *
     * A look is pure presentation and the server has no way to ask Bloxity
     * what somebody else's character wears, so it takes the sender's word for
     * it - laundered by `AvatarState.apply`, which is what stops an id
     * becoming an arbitrary URL on fifteen other machines. Nothing here can
     * reach progression.
     */
    this.onMessage(MessageType.AvatarLook, (client, message: AvatarLookMessage) => {
      this.state.players.get(client.sessionId)?.avatar.apply(message);
    });
    /*
     * Who the portal says this player is.
     *
     * Taken from the client for the same reason a look is: there is no
     * server-to-server route that answers "who owns this socket", and a name
     * buys a label on a sign and never a Win. Requiring a server-verified name
     * is what used to leave every signed-in player showing as a guest.
     */
    this.onMessage(MessageType.SetIdentity, (client, message: SetIdentityMessage) =>
      this.writeIdentity(client.sessionId, message),
    );

    this.setSimulationInterval(
      (deltaMs) => this.tick(deltaMs / 1000),
      serverConfig.patchRateMs,
    );

    logger.info(
      SCOPE,
      `room ${this.roomId} created (capacity ${MAX_PLAYERS_PER_ROOM})`,
    );
  }

  /**
   * The capacity check that does not depend on the matchmaker.
   *
   * `maxClients` is enforced when a seat is RESERVED, which is the right place
   * and covers every normal join. This is the second line: a seat reservation
   * that is consumed late, a direct `joinById` into a room that filled while
   * the request was in flight, or any future path that reaches a room without
   * going through matchmaking would all arrive here. Refusing at the door
   * costs one comparison and makes the limit a property of the ROOM rather
   * than of the route taken to it.
   */
  override onAuth(): boolean {
    if (this.clients.length >= MAX_PLAYERS_PER_ROOM) {
      logger.warn(
        SCOPE,
        `refused a join: room ${this.roomId} is full ` +
          `(${this.clients.length}/${MAX_PLAYERS_PER_ROOM})`,
      );
      throw new ServerError(4103, 'room is full');
    }
    return true;
  }

  override onJoin(client: Client, options: JoinOptions = {}): void {
    const player = new PlayerState();
    player.sessionId = client.sessionId;

    const playerId =
      typeof options.playerId === 'string' ? options.playerId.slice(0, 64) : '';
    if (playerId) this.playerIds.set(client.sessionId, playerId);

    // Restore BEFORE any service initialises: level, movement speed and the
    // equipped tier are all derived from the restored figures, so restoring
    // afterwards would leave every one of them a step out of date.
    const restored = playerId ? profileStore.restore(playerId, player) : false;

    this.state.players.set(client.sessionId, player);

    this.movement.initialise(player);
    this.upgrades.initialise(player);
    this.speeds.initialise(player);
    this.rebirths.sync(player);

    // `initialise` reset the level to 1 for a fresh profile; a restored one
    // has to be re-derived from the Speed it came back with.
    if (restored) this.speeds.syncDerived(player);

    // Who the portal says they are, if the client knew before it joined.
    // Without this a returning player is nameless until their next portal
    // event, which for somebody who logged in before loading is never.
    this.writeIdentity(client.sessionId, options.identity);

    // In the background: a join must not wait on a round trip to Bloxity.
    if (typeof options.bloxityToken === 'string' && options.bloxityToken) {
      this.resolveIdentity(client.sessionId, options.bloxityToken);
    }

    // Put the player at spawn through the SAME path a respawn takes, so there
    // is one definition of "where a player belongs" rather than two.
    this.placeAt(client, player, 'join');

    logger.info(
      SCOPE,
      `join ${client.sessionId} (${restored ? 'restored' : 'new'}) ` +
        `level=${player.level} wins=${player.wins} tier=${player.tierSlot}`,
    );
  }

  override onLeave(client: Client): void {
    const player = this.state.players.get(client.sessionId);
    const playerId = this.playerIds.get(client.sessionId);
    if (player && playerId) profileStore.save(playerId, player);

    this.state.players.delete(client.sessionId);
    this.movement.forget(client.sessionId);
    this.speeds.forget(client.sessionId);
    this.playerIds.delete(client.sessionId);
    this.bloxityIds.delete(client.sessionId);
    this.identityChecks.delete(client.sessionId);

    logger.info(SCOPE, `leave ${client.sessionId}`);
  }

  override onDispose(): void {
    // Every remaining player's progression, made durable before the room dies.
    for (const [sessionId, player] of this.state.players) {
      const playerId = this.playerIds.get(sessionId);
      if (playerId) profileStore.save(playerId, player);
    }
    logger.info(SCOPE, `room ${this.roomId} disposed`);
  }

  /**
   * One input: simulate it, then pay for the movement it actually produced.
   *
   * The ORDER is the whole point. `applyInput` writes the authoritative
   * transform, and only then does `credit` measure the distance between the
   * previous authoritative position and this one. Crediting from the message
   * would be paying a client for a number it chose.
   */
  private onMove(client: Client, message: MoveMessage): void {
    const player = this.state.players.get(client.sessionId);
    if (!player) return;

    if (
      !this.movement.applyInput(client.sessionId, player, message, this.state.elapsed)
    ) {
      return;
    }

    this.speeds.credit(client.sessionId, player, this.movement.lastStep);
    player.animation = resolveAnimation(player);
  }

  /** A stage claim. The server validates it against its own transform. */
  private onClaimStage(client: Client, message: ClaimStageMessage): void {
    const player = this.state.players.get(client.sessionId);
    if (!player) return;

    const index = Number(message?.stageIndex);
    if (!Number.isFinite(index)) return;

    const award = this.stages.claim(player, index);
    if (!award.granted || !award.stage) return;

    const payload: StageAwardedMessage = {
      stageIndex: award.stage.index,
      wins: award.wins,
      total: player.wins,
    };
    client.send(MessageType.StageAwarded, payload);

    // Deliberately NO teleport. Crossing a banner advances the player INTO the
    // next stage - that is what a finish line spanning the course promises,
    // and it is what makes the ten stages one run rather than ten errands. A
    // second payment is impossible because `stageProgress` has already moved
    // on, not because the player was moved away from the line.
    this.persist(client.sessionId, player);
    logger.info(
      SCOPE,
      `stage ${award.stage.index} banked by ${client.sessionId} ` +
        `(+${award.wins} wins, total ${player.wins})`,
    );
  }

  /** A tile purchase. The server takes the payment and grants the tier. */
  private onBuyUpgrade(client: Client, message: BuyUpgradeMessage): void {
    const player = this.state.players.get(client.sessionId);
    if (!player) return;

    const slot = Number(message?.slot);
    if (!Number.isFinite(slot)) return;

    const claim = this.upgrades.claim(player, slot, this.speeds);
    if (!claim.granted || !claim.tier) return;

    this.persist(client.sessionId, player);
    logger.info(
      SCOPE,
      `${client.sessionId} bought ${claim.tier.name} (+${claim.tier.speedPerStep} Speed, ` +
        `wins left ${player.wins})`,
    );
  }

  /** A rebirth request. The server alone decides whether it is allowed. */
  private onRebirth(client: Client): void {
    const player = this.state.players.get(client.sessionId);
    if (!player) return;

    const result = this.rebirths.rebirth(player, this.speeds);
    if (!result.ok) return;

    // A rebirth resets the RUN as well as the curve: the player's level - and
    // therefore their speed - is no longer what carried them to wherever they
    // were standing, so they start again from the arena.
    this.placeAt(client, player, 'rebirth');
    this.persist(client.sessionId, player);
    logger.info(
      SCOPE,
      `${client.sessionId} rebirthed to ${result.rebirths} (x${result.multiplier})`,
    );
  }

  /**
   * The per-tick pass the client cannot influence.
   *
   * Deaths by disco ball are decided HERE, from the position the server
   * simulated and the clock the server owns, rather than from a client saying
   * it was hit. There is no hazard message in this game for exactly that
   * reason.
   */
  private tick(delta: number): void {
    this.state.elapsed += delta;
    const time = this.state.elapsed;

    // The boards on the arena wall. Rebuilt on their own slow timer inside the
    // service - a leaderboard is not a thing anyone reads twenty times a
    // second, and sorting every profile at tick rate to feed a sign would be
    // the most expensive thing in this room.
    leaderboardService.update(
      delta,
      this.state.leaderboard,
      this.state.players,
      this.playerIds,
    );

    // Bux bought by someone already in the room. One boolean in the common case.
    if (buxGrants.hasPending) {
      for (const [sessionId, player] of this.state.players) this.applyGrants(sessionId, player);
    }

    for (const [sessionId, player] of this.state.players) {
      if (!player.ready) continue;

      const triggers = this.movement.collision.sampleTriggers(
        player.x,
        player.y,
        player.z,
        time,
      );

      if (triggers.fell || triggers.hazard) {
        const client = this.clients.find((c) => c.sessionId === sessionId);
        if (client) this.respawn(client, triggers.fell ? 'fell' : 'hazard');
      }
    }

    this.autosaveTimer += delta;
    if (this.autosaveTimer >= AUTOSAVE_SECONDS) {
      this.autosaveTimer = 0;
      // Speed accrues continuously between the discrete events that otherwise
      // trigger a save, so a crash without this would cost a whole session.
      for (const [sessionId, player] of this.state.players) {
        this.persist(sessionId, player);
      }
    }
  }

  /**
   * Sanitise a name and portrait, and show them to the whole room.
   *
   * The ONE path either field is set by. Assigned only on a real change: an
   * identical write still counts as a change to the schema encoder, and an
   * identity is re-sent whenever the portal so much as re-reports it.
   */
  private writeIdentity(sessionId: string, message: Partial<SetIdentityMessage> | undefined): void {
    const player = this.state.players.get(sessionId);
    if (!player) return;
    const name = sanitiseDisplayName(message?.name);
    const pfp = sanitisePfpUrl(message?.pfp);
    if (player.displayName !== name) player.displayName = name;
    if (player.avatarUrl !== pfp) player.avatarUrl = pfp;
    // Persist it, so the boards can still name this player after they leave.
    const playerId = this.playerIds.get(sessionId);
    if (playerId && name) profileStore.save(playerId, player);
  }

  /**
   * Resolve a Bloxity token to an account, then hand over anything it bought.
   *
   * An empty token is a logout. Every call supersedes the one before it, so a
   * slow verification of an old token can never overwrite a newer answer.
   */
  private resolveIdentity(sessionId: string, token: string): void {
    const check = (this.identityChecks.get(sessionId) ?? 0) + 1;
    this.identityChecks.set(sessionId, check);

    if (!token) {
      // A logout. The NAME is not touched here - it arrives by `SetIdentity`
      // from the same portal event, and this path exists only to stop a
      // purchase being granted to an account that has signed out.
      this.bloxityIds.delete(sessionId);
      return;
    }

    void verifyBloxityToken(token, serverConfig.bloxityApiBase).then((user) => {
      if (this.identityChecks.get(sessionId) !== check) return;
      const player = this.state.players.get(sessionId);
      if (!player) return;
      if (!user) {
        this.bloxityIds.delete(sessionId);
        return;
      }
      this.bloxityIds.set(sessionId, user.id);
      logger.info(SCOPE, `${sessionId} verified as Bloxity @${user.username} (for Bux)`);
      this.applyGrants(sessionId, player);
    });
  }

  /**
   * Hand over purchases waiting for this player's verified account.
   *
   * Through `wallet.add` like every other award - there is one place Wins move -
   * and saved immediately, so a crash before the next autosave cannot lose them.
   */
  private applyGrants(sessionId: string, player: PlayerState): void {
    const bloxityId = this.bloxityIds.get(sessionId);
    if (!bloxityId) return;
    const grants = buxGrants.drain(bloxityId);
    if (grants.length === 0) return;
    for (const grant of grants) {
      wallet.add(player, grant.wins);
      logger.info(SCOPE, `granted ${grant.sku} to ${sessionId} (+${grant.wins} wins) [${grant.transactionId}]`);
    }
    this.persist(sessionId, player);
  }

  /** Put a player back at the arena and tell them so. */
  private respawn(client: Client, reason: RespawnReason): void {
    const player = this.state.players.get(client.sessionId);
    if (!player) return;
    this.placeAt(client, player, reason);
  }

  /**
   * THE one way a player is placed, and there is exactly ONE destination.
   *
   * `SPAWN_POSITION` - the red carpet - whatever the cause and whatever stage
   * the player was on. A death sends the player home; only a FINISH LINE moves
   * them forward, and that one does it by not teleporting them at all. This
   * takes no position for exactly that reason: a placement that could land
   * somewhere else is a checkpoint system waiting to be reintroduced.
   *
   * Teleports the simulation, drops the Speed baseline (or the teleport itself
   * would be credited as distance travelled), restarts the stage ladder for
   * the new run, and sends the authoritative transform.
   */
  private placeAt(client: Client, player: PlayerState, reason: RespawnReason): void {
    this.movement.teleport(
      client.sessionId,
      player,
      SPAWN_POSITION.x,
      SPAWN_POSITION.y,
      SPAWN_POSITION.z,
      SPAWN_ROTATION_Y,
    );
    this.speeds.reset(client.sessionId, player);
    this.stages.beginRun(player);
    player.animation = PlayerAnimationState.Idle;
    // A death plays the fall-over. Arriving and being reborn are PLACEMENTS
    // rather than deaths, so neither bumps the counter.
    if (reason === 'fell' || reason === 'hazard' || reason === 'guard') {
      player.deathCount += 1;
    }

    const message: RespawnMessage = {
      x: SPAWN_POSITION.x,
      y: SPAWN_POSITION.y,
      z: SPAWN_POSITION.z,
      rotationY: SPAWN_ROTATION_Y,
      reason,
    };
    client.send(MessageType.Respawn, message);

    // Every placement is logged with its cause. A player who finds themselves
    // back at the arena and cannot say why is the hardest bug in this game to
    // diagnose from the outside, and one line here answers it - which matters
    // more than usual now that one of the causes is a guard the server never
    // sees.
    if (reason !== 'join') {
      logger.info(SCOPE, `place ${client.sessionId} -> spawn (${reason})`);
    }
  }

  private persist(sessionId: string, player: PlayerState): void {
    const playerId = this.playerIds.get(sessionId);
    if (playerId) profileStore.save(playerId, player);
  }
}

/**
 * The animation state a replicated player is in.
 *
 * Derived from motion the server already owns rather than reported by the
 * client, so a remote character can never be made to play an animation its
 * actual movement does not justify. Presentation, but presentation the server
 * is the source of.
 *
 * There is no walk and no run in this list because there is no walk and no run
 * in the game: on the ground a moving player is MOONWALKING, at every speed.
 */
const resolveAnimation = (player: PlayerState): PlayerAnimationState => {
  // A player on a belt is travelling nowhere but is very much moonwalking, so
  // the replicated state has to say so - reporting `idle` would be the one
  // field on the wire that disagrees with what everybody can see.
  if (player.treadmill > 0) return PlayerAnimationState.Moonwalk;
  if (!player.grounded) return PlayerAnimationState.Jump;
  return player.speed < 0.6
    ? PlayerAnimationState.Idle
    : PlayerAnimationState.Moonwalk;
};
