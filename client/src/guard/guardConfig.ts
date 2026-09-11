/**
 * The monster: tuning.
 *
 * Lives in `client/` rather than in `shared/` and that placement is the whole
 * point of the feature. It is simulated by ONE machine for ONE player and is
 * never drawn for anybody else, so there is no second party to agree with -
 * and a number in `shared/` announces an agreement that does not exist.
 */
export const GUARD = {
  /**
   * How far behind the player it is placed at the start of a chase.
   *
   * Far enough to be a shape in the dark rather than a jump-scare, close
   * enough to be unmistakably coming.
   */
  spawnBehind: 34,

  /**
   * Body metrics, in world units.
   *
   * The player is 3.2 tall. This is a MONSTER, not a bouncer: at 12.5 it is
   * nearly four times the player's height, and it is built wide and hunched so
   * the silhouette reads as something that should not fit in the corridor.
   */
  height: 12.5,
  shoulderWidth: 7.4,
  depth: 4.6,

  /**
   * How close it must get to end the run.
   *
   * Scaled to the body rather than to the player's: a creature this size that
   * had to touch you with its centre would have its whole chest pass through
   * you first. It is roughly the shoulder half-width, so being anywhere under
   * the thing is being caught.
   */
  catchRadius: 4.2,

  /**
   * Base speed, as a FRACTION of the player's own current top speed.
   *
   * A fraction rather than an absolute, and that is what makes the chase
   * survive the progression curve. A monster at a fixed 30 units a second is
   * terrifying at level 1 and completely irrelevant at level 60; one at 80% of
   * whatever the player can actually do is the same pressure for ever.
   */
  baseSpeedFraction: 0.8,

  /**
   * Extra speed fraction per stage reached, up to `maxSpeedFraction`.
   *
   * The specified ramp: the further into the course a player gets, the harder
   * the thing behind them pushes.
   */
  speedFractionPerStage: 0.022,

  /** The ceiling. At or above 1 the monster is simply faster than the player. */
  maxSpeedFraction: 0.97,

  /**
   * Seconds of grace after a placement before it starts moving.
   *
   * Arriving at the arena into the arms of something that never stopped
   * running is the single most frustrating thing this feature can do, so every
   * placement buys the player a moment to get going.
   */
  graceSeconds: 2.4,

  /**
   * How far into the course the player must be before the chase begins.
   *
   * THIS IS THE HEAD START, and it exists because of a real bug. The monster
   * used to wait at the mouth of the course and start the moment the player
   * crossed the line - which put it a handful of units AHEAD of somebody who
   * had just stepped out of the arch, and killed anybody who paused just
   * outside the arena in about two seconds. Standing still is not supposed to
   * be fatal.
   *
   * So the chase does not begin at the boundary. It begins here, well down the
   * first stage, by which point the player is past the monster and moving.
   */
  headStart: 46,

  /**
   * How far to the SIDE it waits while the player is in the arena.
   *
   * Expressed as a fraction of the corridor half-width. The other half of the
   * fix above: a monster parked on the centreline is a monster standing in the
   * doorway, so it waits hard against the wall and the carpet out of the arch
   * is always clear.
   */
  waitLaneFraction: 0.72,

  /** How far past the arch it waits. Visible from the arena, out of the way. */
  mouthOffset: 12,

  /**
   * How fast it turns to face its travel, in radians per second.
   *
   * Slower than instant, so it leans into a corner rather than pivoting - a
   * silhouette this big that snapped would read as a cardboard cutout.
   */
  turnSpeed: 4,

  /**
   * How far it may trail the player before it is re-placed behind them.
   *
   * A player who is this far ahead has outrun the chase entirely, and a
   * monster trudging half a stage back is one nobody will ever see again.
   */
  leashDistance: 300,

  /**
   * How fast it settles onto a new floor height, per second.
   *
   * It does NOT fall. A creature this size strides over a gap in a catwalk
   * rather than dropping into it, and easing the height is what makes a riser
   * a step up rather than a snap.
   */
  climbRate: 7,

  /** Stride cadence at full speed, in strides per second, for the lumber. */
  strideRate: 1.35,
  /** How far the body rolls and dips with each stride. */
  strideRoll: 0.07,
  strideBob: 0.42,

  /**
   * Colours. Charcoal hide, hot pink eyes.
   *
   * The hide is lifted a little off true black on purpose: this is a night
   * scene with a very low ambient, and a creature at 0x0a0b11 is a hole in the
   * screen rather than a shape in it. It still reads as a silhouette - it just
   * has edges.
   */
  hide: 0x232838,
  hideDark: 0x151926,
  claw: 0x39405a,
  eye: 0xff2d78,
  glow: 0xff2d78,
} as const;

/**
 * The monster's speed for a player at a given stage and top speed.
 *
 * ONE evaluator, so the difficulty ramp is a curve rather than a scattering of
 * magic numbers. `stage` is 0 in the arena and 1-based once the player is on
 * the course.
 */
export const guardSpeedFor = (playerTopSpeed: number, stage: number): number => {
  const reached = Math.max(0, Math.floor(stage));
  const fraction = Math.min(
    GUARD.baseSpeedFraction + reached * GUARD.speedFractionPerStage,
    GUARD.maxSpeedFraction,
  );
  return Math.max(8, playerTopSpeed * fraction);
};
