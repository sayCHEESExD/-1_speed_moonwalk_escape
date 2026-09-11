import { Schema, type } from '@colyseus/schema';
import {
  INITIAL_OWNED_TIERS,
  PlayerAnimationState,
  SPAWN_POSITION,
  SPAWN_ROTATION_Y,
  STARTER_TIER_SLOT,
  type PlayerAnimationState as AnimationState,
} from '@moonwalk/shared';

/**
 * Replicated per-player state.
 *
 * Every field here is written by the SERVER. Transform and motion come out of
 * the authoritative simulation; progression, Wins and the owned-tier set are
 * written only by their own service. Nothing is ever copied from a client
 * message.
 *
 * Note what is NOT here: bone rotations, gait timers, and the GUARD. The guard
 * is simulated on each client for its own player alone and is deliberately
 * absent from the wire - see `client/src/guard/`.
 */
export class PlayerState extends Schema {
  @type('string') sessionId = '';

  @type('float32') x: number = SPAWN_POSITION.x;
  @type('float32') y: number = SPAWN_POSITION.y;
  @type('float32') z: number = SPAWN_POSITION.z;
  @type('float32') rotationY: number = SPAWN_ROTATION_Y;

  /** Horizontal speed, drives the remote glide blend. */
  @type('float32') speed = 0;
  /** Vertical velocity, distinguishes the rising and falling poses. */
  @type('float32') verticalVelocity = 0;
  @type('boolean') grounded = true;

  /** Authoritative velocity, needed by the client to reconcile prediction. */
  @type('float32') velocityX = 0;
  @type('float32') velocityY = 0;
  @type('float32') velocityZ = 0;
  /** Highest input sequence the server has simulated for this player. */
  @type('uint32') lastInputSeq = 0;

  /**
   * LATCHED simulation state, replicated so client reconciliation can restore
   * the FULL authoritative motion before it replays unacknowledged input.
   *
   * Neither is a transform and neither is ever read back from a client. Replay
   * is only correct when it resumes from exactly the state the server was in:
   * `jumpLatched` decides whether the next input counts as a fresh press, and
   * `coyote` decides whether a jump just off a plank lip is still allowed.
   * Restoring position and velocity but not these makes replay derive
   * different jump EDGES than the server took.
   */
  @type('boolean') jumpLatched = false;
  @type('float32') coyote = 0;

  /** Monotonic counts, so a remote client can trigger one-shot animations. */
  @type('uint32') jumpCount = 0;
  @type('uint32') deathCount = 0;

  /**
   * Treadmill the player is standing on, or 0.
   *
   * DERIVED by the simulation from the position the server itself computed.
   * There is no treadmill message, so a client can neither claim a belt it is
   * not on nor keep the bonus after stepping off.
   */
  @type('uint8') treadmill = 0;

  @type('string') animation: AnimationState = PlayerAnimationState.Idle;

  /** Server-authoritative progression. */
  @type('uint32') level = 1;
  /**
   * Rebirths performed. `uint32`, not `uint16`: the ladder has no end, and at
   * `uint16` rebirth 65536 would wrap to zero and take the level cap with it.
   */
  @type('uint32') rebirths = 0;
  /** Stage wins. Awarded by StageService only - never read from a client. */
  @type('uint32') wins = 0;
  /** Lifetime farmed Speed. Awarded by SpeedService only. Drives level. */
  @type('float64') totalSpeed = 0;

  /** Equipped speed tier - the best one owned. Written by UpgradeService. */
  @type('uint8') tierSlot = STARTER_TIER_SLOT;
  /** Bitmask of upgrade tiles bought. Written by UpgradeService only. */
  @type('uint32') ownedTiers = INITIAL_OWNED_TIERS;
  /** Speed granted per stride by the equipped tier. */
  @type('float32') speedPerStep = 1;

  /**
   * Authoritative movement multiplier and jump velocity, resolved from level,
   * rebirth and the equipped tier by the one shared formula. The client moves
   * at exactly these - it never derives its own.
   */
  @type('float32') moveMultiplier = 1;
  @type('float32') jumpVelocity = 23;

  /**
   * Level cap for the current rebirth. `uint32`, for the same reason as
   * `rebirths`.
   */
  @type('uint32') maxLevel = 25;

  /** Highest stage (1-based) ever banked. 0 before the first finish. */
  @type('uint32') bestStage = 0;

  /**
   * Stages banked since this player was last placed at the arena.
   *
   * THE thing that makes a finish line payable exactly once. The banner has no
   * teleport behind it - crossing it leaves the player running into the next
   * stage, which is the whole point - so "already paid" cannot be enforced by
   * moving them away from it. This counter is what enforces it instead, and it
   * is replicated because the client has to know which line it should be
   * asking about next.
   */
  @type('uint32') stageProgress = 0;

  /** True once the server has simulated at least one input for this player. */
  @type('boolean') ready = false;
}
