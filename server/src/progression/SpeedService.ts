import {
  MAX_SIM_DELTA,
  SPEED,
  TRAINING,
  maxLevelForRebirth,
  resolveLevel,
  resolveMovementProfile,
  speedForNextLevel,
  tierForSlot,
  treadmillMultiplier,
  type MovementProfile,
} from '@moonwalk/shared';
import type { PlayerState } from '../rooms/state/PlayerState.js';

/** What the server remembers between two simulated steps for one player. */
interface Tracker {
  x: number;
  z: number;
  grounded: boolean;
  /** True until the first step is credited, so spawning pays nothing. */
  fresh: boolean;
}

/** Outcome of crediting one movement step. */
export interface SpeedGain {
  /** Speed added by this step. */
  readonly gained: number;
  /** Levels crossed, if any. */
  readonly levelsGained: number;
}

/**
 * Server authority over Speed farming and levelling.
 *
 * Speed is DERIVED from movement the server actually observes: the distance
 * between consecutive authoritative positions, plus a bonus each time the
 * player leaves the ground. A client cannot ask for Speed, and a single step
 * is capped at a plausible distance, so a teleport pays nothing.
 *
 * Level then drives movement speed through the one shared formula, which is
 * the whole loop - moonwalk to farm Speed, gain levels, get faster, clear the
 * gaps that were out of reach.
 */
export class SpeedService {
  private readonly trackers = new Map<string, Tracker>();

  initialise(player: PlayerState): void {
    player.level = 1;
    player.maxLevel = this.levelCap(player);
    this.syncDerived(player);
    this.reset(player.sessionId, player);
  }

  forget(sessionId: string): void {
    this.trackers.delete(sessionId);
  }

  /**
   * Drop the movement baseline.
   *
   * Called on every respawn: the teleport back to the arena is a huge
   * position delta that must never be credited as distance travelled.
   */
  reset(sessionId: string, player: PlayerState): void {
    this.trackers.set(sessionId, {
      x: player.x,
      z: player.z,
      grounded: true,
      fresh: true,
    });
  }

  /**
   * Credit one simulated step and apply any level-ups.
   *
   * Call AFTER the transform has been updated, so the tracker advances to the
   * position the server just simulated.
   */
  credit(sessionId: string, player: PlayerState, stepSeconds: number): SpeedGain {
    const tracker = this.trackers.get(sessionId);
    if (!tracker) {
      this.reset(sessionId, player);
      return { gained: 0, levelsGained: 0 };
    }

    // ONE rate, and it is simply the equipped tier's own figure. There is no
    // arithmetic here on purpose: what an upgrade is worth belongs in the
    // upgrade ladder, and a second multiplier applied at the point of payment
    // is how two systems end up disagreeing about a player's income.
    const perStride = tierForSlot(player.tierSlot).speedPerStep;
    player.speedPerStep = perStride;

    let gained = 0;

    if (!tracker.fresh) {
      if (player.treadmill > 0) {
        // Moonwalking on a belt. There is no position delta to measure, so the
        // BELT supplies the distance: the player covers ground at the belt's
        // own speed without going anywhere, and it flows through the identical
        // per-stride formula. That is why a treadmill needs no progression
        // path of its own.
        //
        // Paid per simulated second of the SERVER's own step, so a client
        // cannot buy progression by claiming a longer frame - and the belt is
        // read from `player.treadmill`, which the simulation derived from the
        // position the server itself computed.
        const step = Number.isFinite(stepSeconds)
          ? Math.max(0, Math.min(stepSeconds, MAX_SIM_DELTA))
          : 0;
        const distance = TRAINING.beltSpeed * step;
        gained +=
          (distance / SPEED.strideDistance) *
          perStride *
          treadmillMultiplier(player.treadmill);
      } else {
        const distance = Math.hypot(player.x - tracker.x, player.z - tracker.z);

        // Validation uses the SAME speed the player actually moves at, so a
        // fast high-level player is never throttled by a cap tuned for a
        // beginner. Anything beyond it is a teleport and pays nothing at all.
        if (distance <= this.maxCreditedStep(player, stepSeconds)) {
          gained += (distance / SPEED.strideDistance) * perStride;
        }

        // Leaving the ground pays a flat bonus, expressed in strides so it
        // scales with the tier exactly as travel does.
        if (tracker.grounded && !player.grounded) {
          gained += SPEED.jumpBonusStrides * perStride;
        }
      }
    }

    tracker.x = player.x;
    tracker.z = player.z;
    tracker.grounded = player.grounded;
    tracker.fresh = false;

    const beforeLevel = player.level;
    if (gained > 0) player.totalSpeed += gained;

    this.syncDerived(player);

    return { gained, levelsGained: player.level - beforeLevel };
  }

  /**
   * Re-derive level and everything downstream from the current Speed total.
   *
   * Used on join, on reconnect and whenever the equipped tier changes: the
   * profile carries only the Speed earned, and level, movement speed and jump
   * velocity all follow from it through the same formulas a live step uses.
   */
  syncDerived(player: PlayerState): void {
    player.maxLevel = this.levelCap(player);
    player.level = resolveLevel(player.totalSpeed, player.maxLevel).level;

    const tier = tierForSlot(player.tierSlot);
    player.speedPerStep = tier.speedPerStep;

    const profile = this.movementProfile(player);
    player.moveMultiplier = profile.multiplier;
    player.jumpVelocity = profile.jumpVelocity;
  }

  /**
   * THE player's movement profile.
   *
   * Level, the rebirth ladder and the equipped tier all drive it, and every
   * caller that needs a speed - the replicated multiplier, the anti-teleport
   * step cap - goes through here. What the player moves at and what the server
   * will credit therefore cannot disagree.
   */
  movementProfile(player: PlayerState): MovementProfile {
    const tier = tierForSlot(player.tierSlot);
    return resolveMovementProfile(
      player.level,
      player.rebirths,
      tier.moveBonus,
      tier.jumpBonus,
    );
  }

  /** Speed still needed for the next level, for logging and diagnostics. */
  speedToNextLevel(player: PlayerState): number {
    return speedForNextLevel(player.level);
  }

  /**
   * Largest movement the server will credit from one simulated step.
   *
   * Derived from the player's OWN authoritative run speed and the step's own
   * duration rather than a fixed constant, so movement validation and movement
   * itself can never disagree.
   */
  private maxCreditedStep(player: PlayerState, stepSeconds: number): number {
    const step = Number.isFinite(stepSeconds)
      ? Math.max(0, Math.min(stepSeconds, MAX_SIM_DELTA))
      : MAX_SIM_DELTA;
    return this.movementProfile(player).runSpeed * step * SPEED.creditSlack + 0.5;
  }

  private levelCap(player: PlayerState): number {
    return maxLevelForRebirth(player.rebirths);
  }
}
