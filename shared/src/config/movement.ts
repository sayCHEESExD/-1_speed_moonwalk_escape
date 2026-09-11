import { rebirthMultiplier } from './rebirth.js';

/**
 * Movement tuning for a MOONWALKING PLAYER.
 *
 * The client predicts with these numbers and the server simulates with them,
 * so they must not diverge - which is why there is one copy, here.
 *
 * Nothing about the moonwalk lives in this file. A moonwalk is a glide: the
 * physics is an ordinary character on foot, and the illusion is entirely the
 * ANIMATOR's - the body faces the opposite way to the travel. Putting the
 * reversal in the simulation would mean the server and the client had to agree
 * about a presentation trick, which is exactly the sort of thing that ends up
 * agreed on one side only.
 */
export interface MovementConfig {
  /** Glide speed in world units per second, before every multiplier. */
  readonly walkSpeed: number;
  /** Sprint-glide speed in world units per second, before every multiplier. */
  readonly runSpeed: number;
  /** Ground acceleration, world units per second squared. */
  readonly acceleration: number;
  /** Ground deceleration when the stick is released. */
  readonly deceleration: number;
  /** Fraction of ground acceleration retained while airborne (0..1). */
  readonly airControl: number;
  /** Downward acceleration, world units per second squared. */
  readonly gravity: number;
  /** Upward velocity applied on jump, world units per second. */
  readonly jumpVelocity: number;
  /**
   * Turn rate toward the movement direction, radians per second.
   *
   * Slower than a snap on purpose: a moonwalk is a slide, and a character that
   * pivoted instantly would break the glide the whole look depends on.
   */
  readonly turnSpeed: number;
  /**
   * Largest distance the simulation will integrate in one substep.
   *
   * THE reason this game has no speed cap. Late-game movement runs at
   * hundreds of units a second, and a single 1/60s step at that speed would
   * step clean over a kerb, a riser and the gap beyond it. `stepPlayer`
   * subdivides its own step until every substep moves less than this, so
   * collision is exactly as reliable at 400 u/s as at 20.
   */
  readonly maxSubstepDistance: number;
  /** Most substeps one step may take, so a pathological speed cannot hang. */
  readonly maxSubsteps: number;
  /**
   * Height the player steps up without jumping.
   *
   * The carpet trim, the treadmill decks and the upgrade tiles are all below
   * this, so the arena never needs a hop for something that reads as a kerb.
   */
  readonly stepHeight: number;
}

export const MOVEMENT: MovementConfig = {
  walkSpeed: 13,
  runSpeed: 22,
  acceleration: 80,
  deceleration: 52,
  airControl: 0.45,
  gravity: 58,
  jumpVelocity: 23,
  turnSpeed: 8.5,
  maxSubstepDistance: 0.8,
  maxSubsteps: 48,
  stepHeight: 0.9,
};

/**
 * How level, rebirths and the bought speed upgrades combine into ONE movement
 * profile.
 *
 * This is the single evaluator: nothing else may compute a movement speed.
 * The server resolves it and replicates the multiplier; the client multiplies
 * the base speeds above by exactly that and never derives its own. A new
 * modifier is a factor fed through here, never a second formula.
 */
export interface MovementProfile {
  /** Multiplier on `walkSpeed` and `runSpeed`. */
  readonly multiplier: number;
  /** Resolved glide speed in world units per second. */
  readonly walkSpeed: number;
  /** Resolved sprint-glide speed in world units per second. */
  readonly runSpeed: number;
  /** Resolved jump velocity. */
  readonly jumpVelocity: number;
}

/** Speed added per level, as a fraction of the base. */
const SPEED_PER_LEVEL = 0.04;

/**
 * Levels over which the per-level gain decays to half its value.
 *
 * The level term is deliberately NOT linear. A linear term adds the same slab
 * of speed for ever, so a mid-game player is already gliding at 150 units a
 * second and the end of the ladder is past the point where an obstacle can be
 * seen, judged and jumped.
 *
 * Now it tapers: `steps / (1 + steps / LEVEL_SOFT_CAP)` rises quickly at
 * first, so the first twenty levels still feel like getting faster, and
 * converges on `SPEED_PER_LEVEL * LEVEL_SOFT_CAP` - a level ceiling of x2
 * however long anyone grinds.
 *
 * Levelling is therefore not where late-game speed comes from. REBIRTH is,
 * which is what the prestige ladder is for and why it is untouched here.
 */
const LEVEL_SOFT_CAP = 25;

/**
 * Resolve the profile a player actually moves at.
 *
 * THE single evaluator. Every modifier in the game is a FACTOR fed through
 * here - the bought upgrade tier, the rebirth ladder - and none of them is
 * ever a second formula somewhere else.
 *
 * @param level      current level, 1-based
 * @param rebirths   completed rebirth count
 * @param tierMove   the owned upgrade tier's `moveBonus`
 * @param tierJump   the owned upgrade tier's `jumpBonus`
 * @param extra      any future boost, fed through the same product
 */
export const resolveMovementProfile = (
  level: number,
  rebirths: number,
  tierMove = 1,
  tierJump = 1,
  extra = 1,
): MovementProfile => {
  const steps = Math.max(0, Math.floor(level) - 1);
  const safe = (value: number): number =>
    Number.isFinite(value) && value > 0 ? value : 1;

  // Diminishing returns, so a very high level is faster than a high one
  // without being a different game.
  const levelGain = (steps / (1 + steps / LEVEL_SOFT_CAP)) * SPEED_PER_LEVEL;

  const multiplier =
    (1 + levelGain) * rebirthMultiplier(rebirths) * safe(tierMove) * safe(extra);

  return {
    multiplier,
    walkSpeed: MOVEMENT.walkSpeed * multiplier,
    runSpeed: MOVEMENT.runSpeed * multiplier,
    // Jump velocity scales far more gently than travel speed. A jump that grew
    // with the multiplier would put a level-50 player over the neon walls;
    // distance is meant to come from APPROACH SPEED, which it already does.
    jumpVelocity:
      MOVEMENT.jumpVelocity * safe(tierJump) * (1 + Math.min(multiplier - 1, 6) * 0.08),
  };
};
