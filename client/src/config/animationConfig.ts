import type { PoseDefinition } from '../animation/PoseBuffer.js';

const deg = (degrees: number): number => (degrees * Math.PI) / 180;

/**
 * Procedural animation tuning.
 *
 * THERE ARE TWO ANIMATIONS IN THIS GAME, and this file is the whole of both:
 * the MOONWALK, which is every frame the player spends on the ground, and the
 * JUMP, which is every frame they spend off it. There is no walk cycle and no
 * run cycle anywhere in this codebase, and adding one would not be a feature -
 * it would be the thing that stops the character being a moonwalker.
 *
 * Data-driven on purpose: every number the animator uses lives here, so the
 * dance can be re-tuned without touching a line of logic. All rotations are in
 * CHARACTER space (see `PlayerRig`): +x pitches a limb BACKWARD, +y yaws it,
 * +z rolls it.
 */

/**
 * The moonwalk.
 *
 * One cycle is both feet doing the backslide once. The mechanic of the move,
 * and therefore of this table, is that the two legs are doing DIFFERENT things
 * at any instant: one is flat on the floor sliding backward with a straight
 * knee, and the other has its heel up and its knee bent, stepping forward. Half
 * a cycle later they swap. Get that asymmetry wrong and it is just a walk
 * played backwards.
 */
export const MOONWALK = {
  /**
   * Cycle frequency clamp, in cycles per second.
   *
   * The upper bound is the single most important number in this file. Phase
   * advances with DISTANCE, so a late-game player at four hundred units a
   * second would otherwise cycle their feet 150 times a second - a strobe, not
   * a dance. Clamping the cadence keeps the slide readable at any speed, and
   * the sense of pace comes from the world going past, which is where it
   * belongs.
   */
  minFrequency: 0.85,
  maxFrequency: 3.4,

  /** World units of travel that advance the cycle by one full stride. */
  strideDistance: 3.4,

  /** Below this speed the player is standing still. */
  idleSpeed: 0.6,
  /** Speed at which the glide pose is fully in, before the move multiplier. */
  glideSpeed: 9,
  /** Speed at which the full showman version is in, before the multiplier. */
  showSpeed: 20,

  /** How far the thigh reaches, front to back. Gentle - it is a GLIDE. */
  hipReach: { glide: deg(20), show: deg(30) },
  /**
   * Knee flexion on the recovering leg.
   *
   * Deep, and only ever on one leg at a time. This is the heel-pop: the knee
   * bends hard as that foot comes forward on its toe while the other slides.
   */
  kneeBend: { glide: deg(42), show: deg(62) },
  /** How far the sliding leg's knee straightens past neutral. Never negative. */
  slideStraighten: deg(4),

  /** Vertical bob. Small: a moonwalk that bounces is a walk. */
  bob: { glide: 0.022, show: 0.05 },
  /** Forward lean of the torso. The body leans INTO the direction it faces. */
  lean: { glide: deg(6), show: deg(11) },
  /** Shoulder roll, side to side, once per cycle. */
  roll: { glide: deg(3), show: deg(6) },
  /** Hip yaw, counter to the shoulders. */
  hipTwist: { glide: deg(4), show: deg(8) },

  /**
   * The head snap.
   *
   * Not a sine. A moonwalk's head SNAPS - it holds still, flicks to the new
   * angle in a couple of frames and holds again - so the drive is a sine run
   * through a steep tanh, which is a square wave with soft corners. A smooth
   * sine here reads as a nod, and a nod is the one head motion this move does
   * not have.
   */
  headSnap: { glide: deg(13), show: deg(22) },
  /** How sharp the snap is. Higher is squarer; 1 would be a plain sine. */
  headSnapSharpness: 5.5,
  /** Snaps per cycle. Two - one per foot. */
  headSnapsPerCycle: 2,
  /** A little chin lift with each snap. */
  headLift: deg(5),

  /**
   * The raised hand.
   *
   * The one-handed gesture the whole silhouette is built on: the RIGHT arm up
   * with the elbow folded so the hand sits by the hat brim, held there for the
   * entire move. It is a HELD pose with a pulse on it, not a swing - an arm
   * that swung would put the hand somewhere different every frame and the
   * silhouette would stop being recognisable.
   */
  gesture: {
    ArmR1: { x: deg(-104), y: deg(20), z: deg(-14) },
    ArmR2: { x: deg(102) },
  } satisfies PoseDefinition,
  /** How far the raised hand pulses with the cycle. */
  gesturePulse: deg(7),

  /** How far the FREE arm swings, counter to the legs. */
  armSwing: { glide: deg(16), show: deg(26) },
  /** Resting bend in the free elbow. */
  armBend: deg(24),

  /** Idle breathing, so a stopped performer is never a mannequin. */
  breathFrequency: 0.45,
  breathAmount: deg(2.5),
} as const;

/**
 * The jump: crouch, launch, float and land, as ONE animation.
 *
 * Deliberately not four. The player is off the ground for a fraction of a
 * second at these speeds, and four cross-faded states inside that window is
 * four transitions nobody can see and a lot of machinery to keep in step. One
 * pose blended by vertical velocity reads better and is a third of the code.
 */
export const JUMP = {
  /** Seconds of crouch before the player leaves the ground. */
  crouchDuration: 0.08,
  /** How far the body drops during the crouch, in world units. */
  crouchDrop: 0.3,
  /** Seconds of squash on touchdown. */
  landDuration: 0.16,
  /** How far the body drops on landing. */
  landDrop: 0.34,

  /** The rising pose: knees tucked, free arm thrown up, gesture hand held. */
  rise: {
    LegL1: { x: deg(-40) },
    LegL2: { x: deg(66) },
    LegR1: { x: deg(-18) },
    LegR2: { x: deg(40) },
    ArmL1: { x: deg(-118), z: deg(-16) },
    ArmL2: { x: deg(28) },
    Spine1: { x: deg(-7) },
    Spine2: { x: deg(-3) },
    Neck1: { x: deg(6) },
  } satisfies PoseDefinition,

  /** The falling pose: legs reaching for the floor, arm out for balance. */
  fall: {
    LegL1: { x: deg(-14) },
    LegL2: { x: deg(24) },
    LegR1: { x: deg(10) },
    LegR2: { x: deg(16) },
    ArmL1: { x: deg(-58), z: deg(-34) },
    ArmL2: { x: deg(16) },
    Spine1: { x: deg(8) },
    Spine2: { x: deg(4) },
    Neck1: { x: deg(-6) },
  } satisfies PoseDefinition,

  /** Vertical velocity at which each pose is fully applied. */
  velocityReference: 16,

  /** The touchdown squash, folded in over `landDuration`. */
  land: {
    LegL1: { x: deg(-34) },
    LegL2: { x: deg(56) },
    LegR1: { x: deg(-30) },
    LegR2: { x: deg(52) },
    ArmL1: { x: deg(-34), z: deg(-22) },
    Spine1: { x: deg(13) },
    Neck1: { x: deg(-9) },
  } satisfies PoseDefinition,
} as const;

/**
 * The fall-over.
 *
 * Not a third animation, and the distinction matters: it is a half-second
 * procedural tip-over with no cycle, no phase and no locomotion in it, played
 * once when a disco ball or the guard ends a run. Readable, brief, and
 * deliberately not gruesome.
 */
export const DEATH = {
  /** Seconds the whole thing runs before the respawn is applied. */
  duration: 0.5,
  /** How far the body keels over, in radians. */
  roll: deg(88),
  /** How far it pitches as it goes. */
  pitch: deg(20),
  /** How far the body sinks. */
  drop: 0.55,
  /** How far the limbs fling out. */
  splay: deg(34),
} as const;

/** Seconds a pose change takes to blend in. One number, used everywhere. */
export const POSE_BLEND_RATE = 13;

/** Height of the pivot the death tip-over turns about, in world units. */
export const TIP_PIVOT_HEIGHT = 1.1;
