import type { Aabb } from '../types/math.js';
import { totalSpeedToReach } from './speed.js';
import { SPEED_TIERS } from './upgrades.js';

/**
 * The world, as pure data.
 *
 * Everything the player can stand on, bump into or be killed by is defined
 * here, and both the renderer and the authoritative server read the same
 * arrays. There are no world coordinates anywhere else - a platform the client
 * draws but the server does not know about is the one bug this file exists to
 * make impossible.
 *
 * The world is LINEAR along +Z: a wide red-carpet arena under permanent night,
 * then ten stages of carpet running out through a neon city.
 *
 * LEFT and RIGHT always mean the PLAYER's, and they are not what the sign of X
 * suggests. Facing +Z with Y up, "forward cross up" is -X, so the player's
 * RIGHT is NEGATIVE X and their LEFT is positive. The treadmills are on the
 * left at +X and the upgrade tiles on the right at -X, exactly as specified;
 * authoring either from the reading of the number rather than from that cross
 * product is how a feature ends up on the wrong side of the screen.
 */

/** What a solid is for. Presentation reads this; the simulation does not. */
export type SolidKind =
  /** The red carpet the whole course is laid on. */
  | 'carpet'
  /** The arena's tiled floor. */
  | 'plaza'
  /** A raised chrome riser to hop onto or over. */
  | 'riser'
  /** A narrow catwalk plank. */
  | 'plank'
  /** A full-height column to weave around. */
  | 'pillar'
  /** A lit dance-floor panel. */
  | 'glass'
  /** Dark stage masonry: the scaffolding the course runs through. */
  | 'stage'
  /** Painted machinery: truss legs, barrier feet, treadmill frames. */
  | 'metal'
  /** The raised deck the treadmills stand on. */
  | 'deck'
  /** One speed upgrade tile. */
  | 'tile';

/** One axis-aligned solid. */
export interface CourseSolid extends Aabb {
  readonly kind: SolidKind;
  /** Stage this belongs to; -1 for the arena. */
  readonly stage: number;
}

/** How a disco ball moves. Every hazard in this game is a disco ball. */
export type HazardKind =
  /** Swings side to side across the carpet, hung from the rig. */
  | 'sweeper'
  /** Rolls down the carpet toward the player, then recycles to the top. */
  | 'roller'
  /**
   * Orbits a fixed centre in the horizontal plane.
   *
   * The workhorse of the later stages. Several placed at one centre with
   * stepped radii make a rotating BAR of balls rather than a single one, which
   * is how a sweeping arm is drawn with no new physics.
   */
  | 'spinner'
  /**
   * Drops from the lighting rig onto a fixed spot, rests, and winches back up.
   *
   * It hangs for most of its cycle so the lit patch underneath is a real
   * warning rather than a formality.
   */
  | 'faller';

/**
 * A killer.
 *
 * Position is a pure function of TIME, so the server evaluates it from its own
 * clock and the client from the replicated one. There is no hazard state to
 * replicate and nothing for a client to assert.
 */
export interface CourseHazard {
  readonly kind: HazardKind;
  readonly stage: number;
  /** Centre of the sweep, or the lane a roller runs down. */
  readonly x: number;
  readonly y: number;
  /** Resting Z for a sweeper; ignored by a roller, which uses from/to. */
  readonly z: number;
  readonly radius: number;
  /**
   * Sweeper: half-amplitude in X.
   * Spinner: orbit radius about (`x`, `z`).
   * Faller: how far above `y` it hangs before it drops.
   * Roller: unused.
   */
  readonly sweep: number;
  /**
   * Sweeper / spinner: radians per second.
   * Roller: units per second down the lane.
   * Faller: seconds for one complete hang-drop-rest-rise cycle.
   */
  readonly rate: number;
  /** Offset so a row of hazards is never in lockstep. */
  readonly phase: number;
  /** Roller: the Z it starts from (the far end) and rolls toward. */
  readonly fromZ: number;
  readonly toZ: number;
}

/** Scenery the client draws and the simulation ignores. */
export type DecorationKind =
  /** A glowing sign panel, standing beside the course. */
  | 'neonSign'
  /** A velvet-rope stanchion at the carpet's edge. */
  | 'barrier'
  /** A ground-mounted spotlight throwing a cone up into the night. */
  | 'spotlight'
  /** An overhead lighting truss spanning the corridor. */
  | 'truss'
  /** A hanging disco ball that is decoration only and never kills. */
  | 'ball';

export interface Decoration {
  readonly kind: DecorationKind;
  readonly stage: number;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly scale: number;
  readonly rotationY: number;
  /** Free tint for the neon kinds. Presentation only. */
  readonly colour: number;
}

/**
 * A patch of ground that changes how the player HANDLES on it.
 *
 * One mechanic, used sparingly: a polished dance floor lowers `grip`, so a
 * glide keeps its momentum through a turn. It is read by `stepPlayer` itself,
 * so the server's simulation and the client's prediction cannot handle
 * differently - which for a surface whose whole point is the feel of the
 * controls is the difference between a stage and a rubber-banding mess.
 */
export interface SurfaceRegion {
  readonly stage: number;
  readonly minX: number;
  readonly maxX: number;
  readonly minZ: number;
  readonly maxZ: number;
  /**
   * Multiplier on ground acceleration AND braking, 1 being normal carpet.
   *
   * Below 1 is polish. It scales both deliberately - lowering only the braking
   * would make a slick floor a place where the player is simply harder to
   * stop, rather than one where they are harder to steer.
   */
  readonly grip: number;
  /** Constant sideways push, world units per second squared. */
  readonly windX: number;
  /** Constant push along the course. Negative holds the player back. */
  readonly windZ: number;
}

/**
 * A stretch of world WIDER than the running corridor.
 *
 * The arena is one by definition. Movement clamps to whatever this says, the
 * floor is laid at the same width and the renderer builds its walls from the
 * same list - so a wide area cannot end up with a floor and a boundary that
 * disagree.
 */
export interface WideArea {
  readonly minZ: number;
  readonly maxZ: number;
  readonly halfWidth: number;
}

/** One stage. */
export interface StageDefinition {
  /** 1-based, as shown on the banner. */
  readonly index: number;
  readonly name: string;
  readonly difficulty: string;
  /** Advisory only - shown on the banner, never enforced. */
  readonly recommendedLevel: number;
  /**
   * Lifetime Speed the recommended level corresponds to.
   *
   * DERIVED from `recommendedLevel` through the same curve the player actually
   * levels on, never authored beside it. A hand-written figure here would be
   * free to drift into advertising a Speed total that does not correspond to
   * the level printed next to it, and the banner shows both.
   */
  readonly recommendedSpeed: number;
  readonly startZ: number;
  readonly endZ: number;
  /**
   * Z of the finish banner: the line that pays.
   *
   * A LINE across the whole corridor, not a pad in a corner. Crossing it is
   * the reward, so there is nothing to find and nothing to walk into - which
   * is exactly what a banner spanning the course promises.
   */
  readonly finishZ: number;
  /** Wins awarded for crossing it. */
  readonly winReward: number;
}

/** Global world metrics. */
export const COURSE = {
  /**
   * Half-width of the running corridor.
   *
   * Every lateral position in the stages is expressed as a FRACTION of this
   * (see `lane`), so widening the world moves the obstacles with it instead of
   * leaving them clustered down the middle of a wider carpet.
   */
  halfWidth: 30,
  /** Top of the course floor. Everything is measured from here. */
  floorY: 0,
  /** Thickness of a floor slab, so a slab has an underside to head-butt. */
  floorThickness: 4,
  /** Height of the neon side walls. Visual; the X clamp is what holds. */
  wallHeight: 34,

  /**
   * The bottom of the world.
   *
   * A REAL surface, drawn under the whole map. Without it a fall shows the
   * underside of the course and an infinite void, which is what makes a world
   * look unfinished; with it, falling reads as dropping to a lit service level
   * that was always there.
   */
  pitFloorY: -22,

  /** The red-carpet arena. Deliberately large enough for a full event. */
  lobbyHalfWidth: 56,
  lobbyStartZ: -118,
  lobbyEndZ: 0,

  /** Bridge from one stage's end to the next stage's run-up. */
  stageGap: 24,
  /** How many stages exist. */
  stageCount: 10,
} as const;

/** Half-width of the raised carpet runner down the middle of the arena. */
export const ARENA_CARPET_HALF_WIDTH = 13;

/**
 * Every stage, in one table.
 *
 * Name, difficulty word and recommended level for all ten, so tuning the
 * ladder is editing rows here rather than hunting through builders.
 */
interface StageTuning {
  readonly name: string;
  readonly difficulty: string;
  /**
   * Level the stage is built around.
   *
   * The ramp respects the rebirth ladder: the cap is 25 levels per rebirth, so
   * stage 5 at 15 is inside a first run, stage 8 at 40 wants one rebirth and
   * stage 10 at 66 wants two. Nothing here asks for a level the ladder cannot
   * reach.
   */
  readonly recommendedLevel: number;
}

const STAGE_TUNING: readonly StageTuning[] = [
  { name: 'Red Carpet', difficulty: 'EASY', recommendedLevel: 1 },
  { name: 'Rope Line', difficulty: 'EASY', recommendedLevel: 3 },
  { name: 'Flashbulbs', difficulty: 'EASY', recommendedLevel: 6 },
  { name: 'The Catwalk', difficulty: 'NORMAL', recommendedLevel: 10 },
  { name: 'Paparazzi Pit', difficulty: 'NORMAL', recommendedLevel: 15 },
  { name: 'Falling Rig', difficulty: 'HARD', recommendedLevel: 22 },
  { name: 'Neon Columns', difficulty: 'HARD', recommendedLevel: 30 },
  { name: 'Dance Floor', difficulty: 'INSANE', recommendedLevel: 40 },
  { name: 'Hall of Mirrors', difficulty: 'INSANE', recommendedLevel: 52 },
  { name: 'Grand Finale', difficulty: 'NIGHTMARE', recommendedLevel: 66 },
];

/**
 * Wins per stage, exactly as specified.
 *
 * The ONE place a stage reward is written. Anything past the table continues
 * the same accelerating curve, so an eleventh stage needs no edit here.
 */
const STAGE_REWARDS = [
  1, 5, 40, 100, 450, 2_500, 15_000, 75_000, 250_000, 1_000_000,
] as const;

export const stageReward = (index: number): number => {
  const at = Math.max(1, Math.floor(index));
  const authored = STAGE_REWARDS[at - 1];
  if (authored !== undefined) return authored;
  const last = STAGE_REWARDS[STAGE_REWARDS.length - 1] as number;
  return Math.round(last * 4 ** (at - STAGE_REWARDS.length));
};

/**
 * The finish banner: a transparent sheet spanning the WHOLE corridor.
 *
 * It is scenery. What pays is `hasCrossedFinish`, a CROSSING test against the
 * player's Z - which is why there is no pad to find, no corner to visit and
 * nothing to walk into. The banner is simply where the line is drawn.
 */
export const FINISH_BANNER = {
  /** Height of the sheet above the carpet. */
  height: 15,
  /** How far above the carpet the sheet's bottom edge sits. */
  clearance: 0.4,
  /** Half-thickness of the posts either side. */
  postHalf: 1.1,
  /** How far past the corridor edge the posts stand. */
  postOverhang: 2.5,
} as const;

/** First stage begins exactly where the arena floor ends. */
const FIRST_STAGE_Z: number = COURSE.lobbyEndZ;

const solids: CourseSolid[] = [];
const wideAreas: WideArea[] = [];
const hazards: CourseHazard[] = [];
const decorations: Decoration[] = [];
const surfaces: SurfaceRegion[] = [];
const stages: StageDefinition[] = [];

/**
 * A lateral position as a FRACTION of the corridor's half-width.
 *
 * Every obstacle offset goes through here. A literal `x: 7` would leave the
 * whole course huddled around the centreline if the corridor were ever
 * widened; a fraction moves with it.
 */
const lane = (fraction: number): number => COURSE.halfWidth * fraction;

/** Push a carpet slab spanning the full corridor, or a given half-width. */
const pushFloor = (
  stage: number,
  fromZ: number,
  toZ: number,
  halfWidth: number = COURSE.halfWidth,
  kind: SolidKind = 'carpet',
): void => {
  if (toZ <= fromZ) return;
  solids.push({
    minX: -halfWidth,
    maxX: halfWidth,
    minY: COURSE.floorY - COURSE.floorThickness,
    maxY: COURSE.floorY,
    minZ: fromZ,
    maxZ: toZ,
    kind,
    stage,
  });
};

/** Push an arbitrary box, given its centre and size. `baseY` is its bottom. */
const pushBox = (
  stage: number,
  kind: SolidKind,
  centreX: number,
  baseY: number,
  centreZ: number,
  width: number,
  height: number,
  depth: number,
): void => {
  solids.push({
    minX: centreX - width / 2,
    maxX: centreX + width / 2,
    minY: baseY,
    maxY: baseY + height,
    minZ: centreZ - depth / 2,
    maxZ: centreZ + depth / 2,
    kind,
    stage,
  });
};

/** Declare a stretch of world wider than the corridor. */
const markWide = (fromZ: number, toZ: number, halfWidth: number): void => {
  wideAreas.push({ minZ: fromZ, maxZ: toZ, halfWidth });
};

/** A patch of floor that handles differently. */
const pushSurface = (
  stage: number,
  minX: number,
  maxX: number,
  minZ: number,
  maxZ: number,
  grip: number,
  windX = 0,
  windZ = 0,
): void => {
  surfaces.push({ stage, minX, maxX, minZ, maxZ, grip, windX, windZ });
};

/** Push one piece of scenery. */
const pushDecor = (
  kind: DecorationKind,
  stage: number,
  x: number,
  y: number,
  z: number,
  scale = 1,
  rotationY = 0,
  colour = 0xffffff,
): void => {
  decorations.push({ kind, stage, x, y, z, scale, rotationY, colour });
};

/**
 * One rotating arm of disco balls.
 *
 * Several hazards at STEPPED radii sharing one phase, so they read as a single
 * rigid arm sweeping the floor rather than as beads on a string - and the kill
 * test still only knows about one shape.
 */
const pushSpinArm = (
  stage: number,
  centreX: number,
  centreZ: number,
  options: {
    readonly balls: number;
    readonly reach: number;
    readonly radius: number;
    readonly rate: number;
    readonly phase: number;
    readonly y: number;
  },
): void => {
  for (let i = 1; i <= options.balls; i += 1) {
    hazards.push({
      kind: 'spinner',
      stage,
      x: centreX,
      y: options.y,
      z: centreZ,
      radius: options.radius,
      sweep: (options.reach * i) / options.balls,
      rate: options.rate,
      phase: options.phase,
      fromZ: 0,
      toZ: 0,
    });
  }
};

/** One ball that drops out of the rig onto a fixed spot and winches back up. */
const pushFaller = (
  stage: number,
  x: number,
  z: number,
  options: {
    readonly radius: number;
    readonly hang: number;
    readonly cycle: number;
    readonly phase: number;
  },
): void => {
  hazards.push({
    kind: 'faller',
    stage,
    x,
    y: COURSE.floorY + options.radius * 0.7,
    z,
    radius: options.radius,
    sweep: options.hang,
    rate: options.cycle,
    phase: options.phase,
    fromZ: 0,
    toZ: 0,
  });
};

/** One ball rolling down a lane toward the player. */
const pushRoller = (
  stage: number,
  x: number,
  fromZ: number,
  toZ: number,
  radius: number,
  rate: number,
  phase: number,
): void => {
  hazards.push({
    kind: 'roller',
    stage,
    x,
    y: COURSE.floorY + radius,
    z: fromZ,
    radius,
    sweep: 0,
    rate,
    phase,
    fromZ,
    toZ,
  });
};

/** One ball swinging across the carpet. */
const pushSweeper = (
  stage: number,
  z: number,
  radius: number,
  sweep: number,
  rate: number,
  phase: number,
  y = COURSE.floorY + 1.6,
): void => {
  hazards.push({
    kind: 'sweeper',
    stage,
    x: 0,
    y,
    z,
    radius,
    sweep,
    rate,
    phase,
    fromZ: 0,
    toZ: 0,
  });
};

// ---------------------------------------------------------------------------
// The arena.
// ---------------------------------------------------------------------------

markWide(COURSE.lobbyStartZ, COURSE.lobbyEndZ, COURSE.lobbyHalfWidth);

// The tiled plaza floor: the whole arena footprint.
solids.push({
  minX: -COURSE.lobbyHalfWidth,
  maxX: COURSE.lobbyHalfWidth,
  minY: COURSE.floorY - COURSE.floorThickness,
  maxY: COURSE.floorY,
  minZ: COURSE.lobbyStartZ,
  maxZ: COURSE.lobbyEndZ,
  kind: 'plaza',
  stage: -1,
});

/**
 * The red carpet runner down the middle of the arena.
 *
 * A real solid laid ON the plaza rather than a painted decal, because that is
 * the one way the carpet the player is standing on is the same object the
 * server thinks they are standing on. It is 0.1 tall - far inside
 * `MOVEMENT.stepHeight` - so nobody ever has to hop onto their own carpet.
 */
export const ARENA_CARPET = {
  halfWidth: ARENA_CARPET_HALF_WIDTH,
  startZ: COURSE.lobbyStartZ + 14,
  endZ: COURSE.lobbyEndZ,
  /** How far the runner stands proud of the plaza. */
  height: 0.1,
} as const;

solids.push({
  minX: -ARENA_CARPET.halfWidth,
  maxX: ARENA_CARPET.halfWidth,
  minY: COURSE.floorY,
  maxY: COURSE.floorY + ARENA_CARPET.height,
  minZ: ARENA_CARPET.startZ,
  maxZ: ARENA_CARPET.endZ,
  kind: 'carpet',
  stage: -1,
});

/**
 * The VIP entrance: the arch the carpet runs out through.
 *
 * Its uprights are real solids standing OUTSIDE the carpet, so the arch frames
 * the way out without ever being something to bump into on the way through.
 * The lintel is scenery - a solid slab overhead would be a ceiling to
 * head-butt at exactly the moment the player is building up speed.
 */
export const VIP_ARCH = {
  /** Z of the arch, right at the mouth of the course. */
  z: COURSE.lobbyEndZ - 5,
  /** Inner half-width of the opening. Wider than the carpet, deliberately. */
  halfWidth: 18,
  /** Height of the opening, to the underside of the lintel. */
  height: 20,
  postWidth: 3.2,
  postDepth: 3.2,
  /** Depth of the lintel above the opening. */
  lintelHeight: 5,
} as const;

for (const side of [-1, 1]) {
  pushBox(
    -1,
    'metal',
    side * (VIP_ARCH.halfWidth + VIP_ARCH.postWidth / 2),
    COURSE.floorY,
    VIP_ARCH.z,
    VIP_ARCH.postWidth,
    VIP_ARCH.height,
    VIP_ARCH.postDepth,
  );
}

/**
 * The training deck, on the player's LEFT.
 *
 * The player's left is POSITIVE X (see the header). Three treadmills, each a
 * different tier so there is a reason to walk past the first one - but they
 * are all usable from the start, because a treadmill you cannot use is a
 * machine standing in an arena doing nothing.
 */
export const TRAINING = {
  /** Raised deck footprint, on the player's LEFT - which is +X. */
  minX: 20,
  maxX: 54,
  minZ: -100,
  maxZ: -30,
  /** Deck top. A shallow step, inside the simulation's landing tolerance. */
  deckY: 0.6,

  /**
   * Belt footprint.
   *
   * The belt runs along X, NOT along Z. A treadmill faces the way its runner
   * does, and the runner is meant to face the carpet in the middle of the
   * arena - which from the deck on the left wall is -X. The three machines are
   * then spaced along Z, standing in a row against the wall.
   */
  beltLength: 17,
  beltWidth: 9,
  /** Walkable height of a belt above the deck. */
  beltHeight: 0.5,
  /** X of every belt's centre. They all face the same way. */
  centerX: 38,
  /** Z of the first belt, and the spacing down the row. */
  firstZ: -84,
  spacingZ: 18,
  /** How many belts. */
  count: 3,

  /**
   * Belt speed, in world units per second.
   *
   * A treadmill has no position delta to measure, so the BELT supplies the
   * distance and it flows through the identical per-stride formula. That is
   * why a treadmill needs no progression path of its own.
   */
  beltSpeed: 26,
} as const;

/**
 * What every belt is worth.
 *
 * ONE multiplier, shared by all three machines. They are IDENTICAL in what
 * they pay, and that is the point: the training bay is somewhere to farm Speed
 * while chatting, not a ladder, so there is nothing to choose between the
 * three and no reason for anybody to queue for a particular one.
 *
 * It is a single constant rather than a number repeated in three rows,
 * because three rows is three places for them to drift apart - and a bay where
 * one belt quietly paid more than the others would be a bug nobody reported,
 * they would just all stand on the same machine.
 *
 * The multiplier feeds the same per-stride formula every other source of Speed
 * feeds. It is not a second progression path, it is a bigger number on the one
 * that already exists.
 */
export const TREADMILL_MULTIPLIER = 4;

/**
 * The three machines.
 *
 * They differ in NAME and in NEON ONLY - the colours are how a player says
 * "meet me at the blue one" across a dark arena, and nothing more. No entry
 * here carries a multiplier, so there is no way for one to become worth more
 * than another.
 */
export interface TreadmillTier {
  /** 1-based, matching the row front to back. */
  readonly index: number;
  readonly name: string;
  /** Neon trim colour. Presentation only. */
  readonly glow: number;
}

export const TREADMILL_TIERS: readonly TreadmillTier[] = [
  { index: 1, name: 'Rehearsal', glow: 0x4dc3ff },
  { index: 2, name: 'Showtime', glow: 0xc06bff },
  { index: 3, name: 'Headliner', glow: 0xffd24d },
];

/** Centre Z of a 1-based treadmill index. They share one X. */
export const treadmillZ = (index: number): number =>
  TRAINING.firstZ + (Math.floor(index) - 1) * TRAINING.spacingZ;

/** Walkable height of every treadmill belt. */
export const TREADMILL_BELT_Y = TRAINING.deckY + TRAINING.beltHeight;

/** Nobody is on a treadmill. */
export const NO_TREADMILL = 0;

/**
 * Which treadmill a position is standing on, or 0.
 *
 * Derived from position ALONE, by both sides, every step. There is no
 * treadmill message: gliding on starts it and gliding off stops it, so there
 * is nothing for a client to claim and nothing to keep after stepping off.
 */
export const treadmillAt = (x: number, y: number, z: number): number => {
  if (y < TREADMILL_BELT_Y - 1.2 || y > TREADMILL_BELT_Y + 3) return NO_TREADMILL;
  // The belt runs along X and the row runs along Z, so the shared axis is X.
  if (Math.abs(x - TRAINING.centerX) > TRAINING.beltLength / 2) return NO_TREADMILL;
  for (let i = 1; i <= TRAINING.count; i += 1) {
    if (Math.abs(z - treadmillZ(i)) <= TRAINING.beltWidth / 2) return i;
  }
  return NO_TREADMILL;
};

/**
 * The multiplier a belt index is worth.
 *
 * Every real belt pays exactly `TREADMILL_MULTIPLIER`. The lookup exists only
 * to answer "is this a belt at all": it returns 1 for "no treadmill" and for
 * anything unrecognised, so a bad or forged index can only ever mean no bonus
 * - never a bonus.
 */
export const treadmillMultiplier = (index: number): number =>
  TREADMILL_TIERS.some((tier) => tier.index === Math.floor(index))
    ? TREADMILL_MULTIPLIER
    : 1;

// The training deck and its three belts are real solids, so the player glides
// onto them the same way they glide onto anything else.
solids.push({
  minX: TRAINING.minX,
  maxX: TRAINING.maxX,
  minY: COURSE.floorY - COURSE.floorThickness,
  maxY: TRAINING.deckY,
  minZ: TRAINING.minZ,
  maxZ: TRAINING.maxZ,
  kind: 'deck',
  stage: -1,
});

for (let i = 1; i <= TRAINING.count; i += 1) {
  pushBox(
    -1,
    'metal',
    TRAINING.centerX,
    TRAINING.deckY,
    treadmillZ(i),
    TRAINING.beltLength,
    TRAINING.beltHeight,
    TRAINING.beltWidth,
  );
}

/**
 * The speed upgrade tiles, down the player's RIGHT.
 *
 * The player's right is NEGATIVE X (see the header). One tile per tier, in a
 * column along the wall rather than a row across it: the arena is far deeper
 * than it is wide, and a row would have run straight across the space the
 * players are meant to gather in.
 *
 * A tile is a PURCHASE, not a pickup. Gliding onto one while holding enough
 * Wins buys the tier; reaching the Wins total alone does nothing, and the
 * price is deducted.
 */
export const TILE_ROW = {
  /** X of every tile. */
  x: -38,
  /** Z of the first tile, and the spacing down the wall. */
  firstZ: -102,
  spacingZ: 9,
  width: 9,
  length: 7.5,
  /** How far a tile stands proud of the plaza. Inside the step height. */
  height: 0.45,
  /** How close the player must be to buy. */
  claimRadius: 4.2,
} as const;

/** Centre Z of the tile for a 1-based tier slot. */
export const tileZ = (slot: number): number =>
  TILE_ROW.firstZ + (Math.floor(slot) - 1) * TILE_ROW.spacingZ;

for (const tier of SPEED_TIERS) {
  pushBox(
    -1,
    'tile',
    TILE_ROW.x,
    COURSE.floorY,
    tileZ(tier.slot),
    TILE_ROW.width,
    TILE_ROW.height,
    TILE_ROW.length,
  );
}

/**
 * The upgrade tile a position is standing on, or 0.
 *
 * The SAME test on both sides, deliberately: a prediction with different
 * bounds would ask for tiles the server refuses, every frame.
 */
export const upgradeTileAt = (x: number, y: number, z: number): number => {
  if (Math.abs(x - TILE_ROW.x) > TILE_ROW.claimRadius) return 0;
  if (y < COURSE.floorY - 1.5 || y > COURSE.floorY + 4) return 0;
  for (const tier of SPEED_TIERS) {
    if (Math.abs(z - tileZ(tier.slot)) <= TILE_ROW.claimRadius) return tier.slot;
  }
  return 0;
};

/**
 * The scoreboard wall.
 *
 * The arena's back wall is deliberately left empty of everything else so the
 * three boards can live on it. It stays the only thing there.
 */
export const SCOREBOARD_WALL = {
  z: COURSE.lobbyStartZ + 1.2,
  y: COURSE.floorY + 13,
  /** X of the leftmost board, and the spacing across the wall. */
  firstX: -26,
  spacingX: 26,
  width: 22,
  height: 20,
} as const;

// A handful of static disco balls and spotlights, so the arena is lit before
// any stage has been reached.
for (let i = 0; i < 5; i += 1) {
  const z = COURSE.lobbyStartZ + 22 + i * 20;
  pushDecor('ball', -1, 0, COURSE.floorY + 26, z, 1.6 + (i % 2) * 0.5, 0, 0xffffff);
}
for (let i = 0; i < 6; i += 1) {
  const z = COURSE.lobbyStartZ + 16 + i * 18;
  for (const side of [-1, 1]) {
    pushDecor(
      'spotlight',
      -1,
      side * (ARENA_CARPET.halfWidth + 5),
      COURSE.floorY,
      z,
      1,
      0,
      side < 0 ? 0xff4d8a : 0x4dc3ff,
    );
  }
}
// Velvet ropes down both sides of the arena carpet.
for (let z = ARENA_CARPET.startZ + 4; z < ARENA_CARPET.endZ - 4; z += 7) {
  for (const side of [-1, 1]) {
    pushDecor('barrier', -1, side * (ARENA_CARPET.halfWidth + 1.6), COURSE.floorY, z);
  }
}

// ---------------------------------------------------------------------------
// The stages.
// ---------------------------------------------------------------------------

/** Solid carpet at the start of every stage, to land and re-aim on. */
const START_RUNWAY = 24;

/** Solid carpet leading to the finish banner, and a little past it. */
const FINISH_APRON = 30;

/**
 * Stage 1: the carpet itself, with small gaps and low trims.
 *
 * The gaps are short on purpose - short enough that a SPRINTING player glides
 * straight across them and a strolling one has to jump. The arithmetic, with
 * `MOVEMENT.gravity` 58 and a landing tolerance of 0.9:
 *
 *   3.4 units at 13.5 u/s (a level-1 stroll) drops 1.84 - a jump
 *   3.4 units at 22.9 u/s (a level-1 sprint) drops 0.64 - lands
 *   3.4 units at 44 u/s   (a level-25 sprint) drops 0.17 - lands easily
 *
 * That is the whole lesson of the first stage: getting faster turns a hopping
 * section into a straight glide.
 *
 * The gap was 4 units first, which put the level-1 sprint at a drop of 0.88
 * against a tolerance of 0.90. It worked, and it was one rounding error in
 * gravity or in the movement curve away from silently becoming unsprintable -
 * in the first thirty seconds of the game, for every new player at once. The
 * margin matters more than the extra half unit of gap did.
 */
const buildRedCarpet = (stage: number, z: number): number => {
  const island = 12;
  const gap = 3.4;
  let at = z;
  for (let i = 0; i < 8; i += 1) {
    pushFloor(stage, at, at + island);
    // A low trim every third island, so the section is not entirely flat.
    //
    // Deliberately UNDER `MOVEMENT.stepHeight`: stage one's promise is that a
    // fast player glides the whole thing, and a bump tall enough to stop
    // somebody dead would break that however small it looks.
    if (i % 3 === 2) {
      const side = i % 2 === 0 ? 1 : -1;
      pushBox(stage, 'riser', side * lane(0.4), COURSE.floorY, at + island / 2, lane(0.5), 0.8, 5);
    }
    pushDecor('barrier', stage, lane(0.92), COURSE.floorY, at + island / 2);
    pushDecor('barrier', stage, -lane(0.92), COURSE.floorY, at + island / 2);
    at += island + gap;
  }
  return at - gap;
};

/**
 * Stage 2: the rope line, with disco balls rolling down it.
 *
 * Solid carpet all the way - the difficulty is entirely the traffic, so the
 * lesson is dodging rather than jumping and the two are taught apart.
 */
const buildRopeLine = (stage: number, z: number): number => {
  const length = 132;
  pushFloor(stage, z, z + length);

  const lanes = [-0.6, -0.2, 0.2, 0.6];
  for (let i = 0; i < lanes.length; i += 1) {
    const at = lanes[i] as number;
    pushRoller(stage, lane(at), z + length, z - 6, 2.6, 26 + i * 3, i * 0.9);
  }
  // A second wave, offset, so the gaps between balls never line up.
  for (let i = 0; i < lanes.length; i += 1) {
    const at = lanes[i] as number;
    pushRoller(stage, lane(at * 0.5), z + length, z - 6, 2.2, 21 + i * 4, 1.7 + i * 0.6);
  }

  pushDecor('truss', stage, 0, COURSE.floorY + 22, z + length * 0.5, 1);
  return z + length;
};

/**
 * Stage 3: flashbulbs - swinging balls over a broken carpet.
 *
 * The first stage that asks for both at once: a gap to clear and something
 * crossing the far side of it.
 */
const buildFlashbulbs = (stage: number, z: number): number => {
  const island = 15;
  const gap = 7;
  let at = z;
  for (let i = 0; i < 7; i += 1) {
    pushFloor(stage, at, at + island);
    pushSweeper(
      stage,
      at + island / 2,
      2.8,
      lane(0.8),
      1.1 + i * 0.08,
      i * 0.85,
      COURSE.floorY + 1.8,
    );
    if (i % 2 === 1) {
      pushDecor('spotlight', stage, lane(0.85), COURSE.floorY, at + 4, 1, 0, 0xffffff);
      pushDecor('spotlight', stage, -lane(0.85), COURSE.floorY, at + 4, 1, 0, 0xffffff);
    }
    at += island + gap;
  }
  return at - gap;
};

/**
 * Stage 4: the catwalk - narrow planks over the drop.
 *
 * No hazards at all. The whole stage is the width of the thing being landed
 * on, and adding a moving ball to it would confuse two different lessons.
 */
const buildCatwalk = (stage: number, z: number): number => {
  const plank = 20;
  const gap = 8;
  const lanes = [0, -0.45, 0.45, -0.25, 0.25, 0];
  let at = z;
  for (let i = 0; i < lanes.length; i += 1) {
    const offset = lanes[i] as number;
    pushBox(
      stage,
      'plank',
      lane(offset),
      COURSE.floorY - 0.6,
      at + plank / 2,
      lane(0.34),
      0.6,
      plank,
    );
    // A rest pad every third plank, wide enough to stop and re-aim on.
    if (i % 3 === 2) {
      pushBox(stage, 'stage', lane(offset), COURSE.floorY - 0.6, at + plank + gap / 2, lane(0.7), 0.6, gap);
    }
    at += plank + gap;
  }
  return at - gap;
};

/**
 * Stage 5: the paparazzi pit - rotating arms of disco balls.
 *
 * Wider than the corridor, so the arms have somewhere to sweep and the player
 * has somewhere to go round them.
 */
const buildPaparazziPit = (stage: number, z: number): number => {
  const halfWidth = 42;
  const length = 130;
  markWide(z, z + length, halfWidth);
  pushFloor(stage, z, z + length, halfWidth);

  for (let i = 0; i < 4; i += 1) {
    const at = z + 22 + i * 30;
    const side = i % 2 === 0 ? 1 : -1;
    pushSpinArm(stage, side * lane(0.4), at, {
      balls: 4,
      reach: 22,
      radius: 2.4,
      rate: 1.15 + i * 0.12,
      phase: i * 1.3,
      y: COURSE.floorY + 1.7,
    });
    pushDecor('ball', stage, side * lane(0.4), COURSE.floorY + 20, at, 2.2, 0, 0xffffff);
  }

  pushDecor('neonSign', stage, -halfWidth + 2, COURSE.floorY + 14, z + length / 2, 1.4, Math.PI / 2, 0xff2d78);
  pushDecor('neonSign', stage, halfWidth - 2, COURSE.floorY + 14, z + length / 2, 1.4, -Math.PI / 2, 0x2dd4ff);
  return z + length;
};

/**
 * Stage 6: the falling rig - balls dropping out of the lighting truss.
 *
 * Each one hangs for most of its cycle, and the lit patch under it tightens as
 * it comes down, so the warning is a real one rather than a formality.
 */
const buildFallingRig = (stage: number, z: number): number => {
  const length = 150;
  pushFloor(stage, z, z + length);

  const spots = [-0.62, -0.2, 0.2, 0.62, -0.4, 0.4, 0, -0.62, 0.62];
  for (let i = 0; i < spots.length; i += 1) {
    const at = z + 18 + i * 15;
    pushFaller(stage, lane(spots[i] as number), at, {
      radius: 3.4,
      hang: 20,
      cycle: 2.6 + (i % 3) * 0.3,
      phase: i * 0.55,
    });
    if (i % 3 === 0) pushDecor('truss', stage, 0, COURSE.floorY + 22, at, 1);
  }

  // Chrome risers to break the sprint, so the drops are met at a rhythm rather
  // than at whatever speed the run-up happened to produce.
  for (let i = 0; i < 3; i += 1) {
    pushBox(stage, 'riser', lane(i % 2 === 0 ? -0.5 : 0.5), COURSE.floorY, z + 40 + i * 38, lane(0.6), 2.4, 8);
  }
  return z + length;
};

/**
 * Stage 7: neon columns - a weave, with traffic coming the other way.
 *
 * The columns are full height, so they block rather than being hopped: this is
 * the stage that asks the player to steer at speed instead of jumping.
 */
const buildNeonColumns = (stage: number, z: number): number => {
  const length = 165;
  pushFloor(stage, z, z + length);

  const rows = 9;
  for (let i = 0; i < rows; i += 1) {
    const at = z + 16 + i * 17;
    // Two columns per row, offset from the row before, so the gap moves.
    const shift = i % 2 === 0 ? 0.28 : -0.28;
    for (const side of [-1, 1]) {
      pushBox(
        stage,
        'pillar',
        lane(side * 0.55 + shift),
        COURSE.floorY,
        at,
        lane(0.24),
        16,
        lane(0.24),
      );
    }
  }

  for (let i = 0; i < 3; i += 1) {
    pushRoller(stage, lane(i - 1) * 0.5, z + length, z - 6, 2.8, 34 + i * 6, i * 1.1);
  }
  return z + length;
};

/**
 * Stage 8: the dance floor - lit glass panels, polished and slick.
 *
 * The one stage with a `SurfaceRegion` on it. Grip drops, so momentum carries
 * through a turn and the gaps have to be lined up early. Both sides run the
 * one formula, so the client's prediction slides exactly as far as the
 * server's simulation does.
 */
const buildDanceFloor = (stage: number, z: number): number => {
  const panel = 16;
  const gap = 9;
  let at = z;
  for (let i = 0; i < 7; i += 1) {
    const offset = i % 2 === 0 ? -0.2 : 0.2;
    pushBox(
      stage,
      'glass',
      lane(offset),
      COURSE.floorY - 0.5,
      at + panel / 2,
      lane(1.1),
      0.5,
      panel,
    );
    pushSurface(
      stage,
      lane(offset) - lane(0.55),
      lane(offset) + lane(0.55),
      at,
      at + panel,
      0.34,
    );
    pushSpinArm(stage, lane(offset), at + panel / 2, {
      balls: 3,
      reach: 15,
      radius: 2.2,
      rate: 1.5 + i * 0.1,
      phase: i * 1.05,
      y: COURSE.floorY + 1.6,
    });
    at += panel + gap;
  }
  return at - gap;
};

/**
 * Stage 9: the hall of mirrors - dense arms over narrow planks.
 *
 * The two mechanics the ladder has taught, at once and at pace.
 */
const buildHallOfMirrors = (stage: number, z: number): number => {
  const plank = 22;
  const gap = 9;
  const lanes = [0, 0.4, -0.4, 0.22, -0.22, 0, 0.35];
  let at = z;
  for (let i = 0; i < lanes.length; i += 1) {
    const offset = lanes[i] as number;
    pushBox(
      stage,
      'plank',
      lane(offset),
      COURSE.floorY - 0.6,
      at + plank / 2,
      lane(0.42),
      0.6,
      plank,
    );
    pushSpinArm(stage, lane(offset), at + plank / 2, {
      balls: 3,
      reach: 13,
      radius: 2.1,
      rate: 1.7 + i * 0.12,
      phase: i * 0.95,
      y: COURSE.floorY + 1.5,
    });
    pushDecor('ball', stage, lane(offset), COURSE.floorY + 18, at + plank / 2, 1.5, 0, 0xffffff);
    at += plank + gap;
  }
  return at - gap;
};

/**
 * Stage 10: the grand finale - every mechanic, in an arena.
 *
 * Wide, so there is room to run; long, so the run has to be sustained; and it
 * ends on the one platform sequence that cannot be glided across at any speed.
 */
const buildGrandFinale = (stage: number, z: number): number => {
  const halfWidth = 44;
  const arena = 96;
  markWide(z, z + arena, halfWidth);
  pushFloor(stage, z, z + arena, halfWidth);

  for (let i = 0; i < 5; i += 1) {
    const at = z + 16 + i * 18;
    const side = i % 2 === 0 ? -1 : 1;
    pushSpinArm(stage, side * lane(0.55), at, {
      balls: 5,
      reach: 26,
      radius: 2.6,
      rate: 1.4 + i * 0.14,
      phase: i * 1.15,
      y: COURSE.floorY + 1.8,
    });
    pushFaller(stage, lane(side * -0.3), at + 8, {
      radius: 3.6,
      hang: 22,
      cycle: 2.4,
      phase: i * 0.7,
    });
  }
  for (let i = 0; i < 4; i += 1) {
    pushRoller(stage, lane((i - 1.5) * 0.45), z + arena, z - 6, 3, 40 + i * 5, i * 0.8);
  }

  let at = z + arena;
  // The last word: six islands with real gaps, no floor underneath.
  const island = 13;
  const gap = 11;
  const lanes = [0, -0.35, 0.35, -0.18, 0.18, 0];
  for (let i = 0; i < lanes.length; i += 1) {
    pushBox(
      stage,
      'stage',
      lane(lanes[i] as number),
      COURSE.floorY - 0.7,
      at + island / 2,
      lane(0.46),
      0.7,
      island,
    );
    pushSweeper(stage, at + island / 2, 2.5, lane(0.7), 1.9, i * 1.2, COURSE.floorY + 1.7);
    at += island + gap;
  }
  return at - gap;
};

/** Every stage builder, in order. Index is the 0-based stage. */
const BUILDERS: readonly ((stage: number, z: number) => number)[] = [
  buildRedCarpet,
  buildRopeLine,
  buildFlashbulbs,
  buildCatwalk,
  buildPaparazziPit,
  buildFallingRig,
  buildNeonColumns,
  buildDanceFloor,
  buildHallOfMirrors,
  buildGrandFinale,
];

/** Running build cursor. Each stage begins exactly where the last one ended. */
let cursorZ: number = FIRST_STAGE_Z;

for (let stageIndex = 0; stageIndex < COURSE.stageCount; stageIndex += 1) {
  const tuning = STAGE_TUNING[
    Math.min(stageIndex, STAGE_TUNING.length - 1)
  ] as StageTuning;
  const startZ = cursorZ;
  let z = startZ;

  pushFloor(stageIndex, z, z + START_RUNWAY);
  z += START_RUNWAY;

  const build = BUILDERS[Math.min(stageIndex, BUILDERS.length - 1)] as (
    stage: number,
    at: number,
  ) => number;
  z = build(stageIndex, z);

  // The finish apron, with the banner across it. The line is at 60% of the
  // apron, so there is solid carpet on BOTH sides of it - a reward that landed
  // the player in mid-air would be the cruellest possible way to pay them.
  pushFloor(stageIndex, z, z + FINISH_APRON);
  const finishZ = z + FINISH_APRON * 0.6;
  z += FINISH_APRON;

  // The bridge across to the next stage's run-up.
  pushFloor(stageIndex, z, z + COURSE.stageGap);
  const endZ = z + COURSE.stageGap;
  cursorZ = endZ;

  stages.push({
    index: stageIndex + 1,
    name: tuning.name,
    difficulty: tuning.difficulty,
    recommendedLevel: tuning.recommendedLevel,
    recommendedSpeed: totalSpeedToReach(tuning.recommendedLevel),
    startZ,
    endZ,
    finishZ,
    winReward: stageReward(stageIndex + 1),
  });
}

/** Every static solid, arena included. */
export const COURSE_SOLIDS: readonly CourseSolid[] = solids;

/** Every hazard. All of them are disco balls. */
export const COURSE_HAZARDS: readonly CourseHazard[] = hazards;

/** Every piece of scenery the simulation ignores. */
export const DECORATIONS: readonly Decoration[] = decorations;

/** Every stage, in order. */
export const STAGES: readonly StageDefinition[] = stages;

/**
 * THE HARD END OF THE GAME. Z past which there is no more world.
 *
 * Derived from the last stage rather than authored, so adding a stage moves it
 * automatically and the boundary can never be left behind the floor.
 */
export const COURSE_END_Z: number =
  stages.length > 0 ? (stages[stages.length - 1] as StageDefinition).endZ : COURSE.lobbyEndZ;

/**
 * Where a hazard is at a given instant.
 *
 * THE one function both sides evaluate. The server checks a death against it
 * with its own clock and the client draws the ball from it with the replicated
 * one, so there is nothing about a hazard on the wire and nothing to forge.
 *
 * @param out mutated in place, so a per-substep call allocates nothing
 */
export const hazardPositionAt = (
  hazard: CourseHazard,
  time: number,
  out: { x: number; y: number; z: number },
): void => {
  const t = Number.isFinite(time) ? time : 0;

  switch (hazard.kind) {
    case 'roller': {
      // Rolls from `fromZ` toward `toZ` and recycles. The span is always
      // travelled in the same direction, so a ball never appears to reverse.
      const span = hazard.fromZ - hazard.toZ;
      const distance = span > 0 ? (t * hazard.rate + hazard.phase * span) % span : 0;
      out.x = hazard.x;
      out.y = hazard.y;
      out.z = hazard.fromZ - distance;
      return;
    }
    case 'spinner': {
      const angle = t * hazard.rate + hazard.phase;
      out.x = hazard.x + Math.cos(angle) * hazard.sweep;
      out.y = hazard.y;
      out.z = hazard.z + Math.sin(angle) * hazard.sweep;
      return;
    }
    case 'faller': {
      out.x = hazard.x;
      out.y = fallerHeightAt(hazard, t);
      out.z = hazard.z;
      return;
    }
    default: {
      out.x = hazard.x + Math.sin(t * hazard.rate + hazard.phase) * hazard.sweep;
      out.y = hazard.y;
      out.z = hazard.z;
    }
  }
};

/**
 * Height of a falling ball at an instant.
 *
 * Four parts, and the proportions are the mechanic: it HANGS for most of the
 * cycle so the patch underneath is a warning, drops fast, rests briefly on the
 * floor and winches back up. A ball that spent equal time in each phase would
 * be a coin flip rather than a decision.
 */
export const fallerHeightAt = (hazard: CourseHazard, time: number): number => {
  const cycle = Math.max(0.4, hazard.rate);
  const top = hazard.y + hazard.sweep;
  const at = (((time + hazard.phase * cycle) % cycle) + cycle) % cycle;

  const hang = cycle * 0.55;
  const drop = cycle * 0.12;
  const rest = cycle * 0.13;

  if (at < hang) return top;
  if (at < hang + drop) {
    // Accelerating, so it reads as falling rather than sliding down.
    const k = (at - hang) / drop;
    return top - hazard.sweep * k * k;
  }
  if (at < hang + drop + rest) return hazard.y;
  const k = (at - hang - drop - rest) / Math.max(1e-4, cycle - hang - drop - rest);
  return hazard.y + hazard.sweep * k;
};

/**
 * How far either side of its anchor a hazard can reach in X.
 *
 * `sweep` means different things to different kinds - an amplitude, an orbit
 * radius, a fall HEIGHT - so the one place that knows which is which is here.
 */
export const hazardReachX = (hazard: CourseHazard): number => {
  switch (hazard.kind) {
    case 'sweeper':
    case 'spinner':
      return hazard.sweep + hazard.radius;
    default:
      return hazard.radius;
  }
};

/**
 * The Z span a hazard can ever occupy.
 *
 * Used to bucket it for collision. Bucketing a roller as if it stood still
 * would leave it drawn, lethal on the server, and completely absent from the
 * client's prediction.
 */
export const hazardZRange = (hazard: CourseHazard): { minZ: number; maxZ: number } => {
  switch (hazard.kind) {
    case 'roller':
      return {
        minZ: Math.min(hazard.fromZ, hazard.toZ) - hazard.radius,
        maxZ: Math.max(hazard.fromZ, hazard.toZ) + hazard.radius,
      };
    case 'spinner':
      return {
        minZ: hazard.z - hazard.sweep - hazard.radius,
        maxZ: hazard.z + hazard.sweep + hazard.radius,
      };
    default:
      return { minZ: hazard.z - hazard.radius, maxZ: hazard.z + hazard.radius };
  }
};

/**
 * Half-width of the playable corridor at a given Z.
 *
 * The arena is far wider than the run it feeds into, so the clamp has to know
 * where the player is standing.
 */
export const corridorHalfWidthAt = (z: number): number => {
  if (z <= COURSE.lobbyEndZ) return COURSE.lobbyHalfWidth;
  for (const area of wideAreas) {
    if (z >= area.minZ && z <= area.maxZ) return area.halfWidth;
  }
  return COURSE.halfWidth;
};

/**
 * Every stretch wider than the corridor, the arena included.
 *
 * The renderer walks this to build its walls, so a wall and a boundary cannot
 * end up in different places.
 */
export const WIDE_AREAS: readonly WideArea[] = [...wideAreas];

/** The stage containing this Z, or null. */
export const stageAt = (z: number): StageDefinition | null => {
  for (const stage of stages) {
    if (z >= stage.startZ && z <= stage.endZ) return stage;
  }
  return null;
};

/**
 * True when a player at this Z is at or past a stage's finish line.
 *
 * A CROSSING test rather than a volume test, and that is not a detail. A
 * late-game player covers hundreds of units a second, so a trigger box of any
 * sane thickness would be stepped clean over by a single frame - the reward
 * would simply stop being paid to the fastest players, which is precisely
 * backwards. "Am I past the line" cannot be outrun.
 *
 * Combined with the server's one-per-run progress counter, it is also what
 * makes a second payment impossible: a stage is claimable exactly once between
 * placements, whether the player stands on the line or sprints through it.
 */
export const hasCrossedFinish = (z: number, stage: StageDefinition): boolean =>
  z >= stage.finishZ;

/**
 * Every patch of ground that handles differently.
 *
 * Read by `stepPlayer` on both sides, so the dance floor is exactly as slick
 * in the client's prediction as in the server's simulation.
 */
export const SURFACE_REGIONS: readonly SurfaceRegion[] = surfaces;

/**
 * The surface a position is standing on, or null for ordinary carpet.
 *
 * Returns the FIRST match, so a small patch pushed before the sheet it sits on
 * wins.
 */
export const surfaceAt = (x: number, z: number): SurfaceRegion | null => {
  for (const region of surfaces) {
    if (x < region.minX || x > region.maxX) continue;
    if (z < region.minZ || z > region.maxZ) continue;
    return region;
  }
  return null;
};
