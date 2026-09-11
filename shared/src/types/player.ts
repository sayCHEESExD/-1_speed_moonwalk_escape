/**
 * Transform-only view of a player, used for both the local prediction and the
 * replicated remote players.
 */
export interface PlayerTransform {
  x: number;
  y: number;
  z: number;
  /** Yaw in radians. Pitch and roll are presentation, so they are not sent. */
  rotationY: number;
}

/**
 * Visual states the animator can be in.
 *
 * There are exactly TWO authored animations in this game - the moonwalk and
 * the jump - and this list is not a contradiction of that: `Idle` is the
 * moonwalk's own rest pose with the glide taken out of it, and `Dying` is a
 * half-second procedural fall-over rather than a locomotion cycle. There is no
 * walk and no run, and there must never be one: the moonwalk is how this
 * character moves on the ground, at every speed.
 *
 * PRESENTATION only. Gameplay authority - position, progression, whether a
 * jump is allowed - never lives here.
 */
export const PlayerAnimationState = {
  /** Standing. The moonwalk pose, held, with a little breathing. */
  Idle: 'idle',
  /** THE ground animation. Glide, head snap, one-hand gesture. */
  Moonwalk: 'moonwalk',
  /** Off the ground: crouch, launch, float and land are one animation. */
  Jump: 'jump',
  /** The brief fall-over after a disco ball or the guard. */
  Dying: 'dying',
} as const;

export type PlayerAnimationState =
  (typeof PlayerAnimationState)[keyof typeof PlayerAnimationState];

/**
 * The compact per-player signals a client needs to reconstruct another
 * player's animation locally.
 *
 * Bone transforms are NEVER sent over the network - every remote player runs
 * the same procedural animator the local one does, driven from these few
 * numbers.
 */
export interface PlayerMotionState {
  /** Horizontal speed in world units per second. Drives the glide blend. */
  speed: number;
  /** Vertical velocity in world units per second. Rise versus fall. */
  verticalVelocity: number;
  /** True while standing on a surface. */
  grounded: boolean;
  /** Monotonic count of jumps started, so a remote can trigger the crouch. */
  jumpCount: number;
  /** Monotonic count of deaths, so a remote can play the fall-over. */
  deathCount: number;
  /**
   * Treadmill the player is standing on, or 0.
   *
   * Replicated so a remote player moonwalks on the spot exactly as the local
   * one does. Derived from position by the simulation - never sent by a client.
   */
  treadmill: number;
}

/** Server-authoritative progression snapshot. */
export interface PlayerProgression {
  level: number;
  /** Completed rebirths. Drives the level cap and the Speed multiplier. */
  rebirths: number;
  /** Stage wins collected. Awarded by the server only. */
  wins: number;
  /** Lifetime Speed farmed by moonwalking. Awarded by the server only. */
  totalSpeed: number;
  /** Slot of the currently equipped speed tier - the best one owned. */
  tierSlot: number;
  /** Bitmask of upgrade tiles bought, one bit per slot. */
  ownedTiers: number;
  /** Authoritative movement multiplier. The client moves at exactly this. */
  moveMultiplier: number;
  /** Authoritative jump velocity, resolved by the same one formula. */
  jumpVelocity: number;
  /** Highest level reachable at the current rebirth. */
  maxLevel: number;
  /** Speed granted per stride, from the equipped tier. */
  speedPerStep: number;
  /** Highest stage index (1-based) the player has ever banked. */
  bestStage: number;
  /**
   * Stages banked since the last time this player was placed at spawn.
   *
   * Replicated because the CLIENT has to know which line pays next: it asks
   * for `stageProgress + 1` and nothing else, so a player sprinting through
   * three banners in a second still gets three separate awards in order rather
   * than three requests for the same one.
   */
  stageProgress: number;
}

/** Everything the client knows about a replicated player. */
export interface PlayerSnapshot
  extends PlayerTransform,
    PlayerMotionState,
    PlayerProgression {
  sessionId: string;
  animation: PlayerAnimationState;
}
