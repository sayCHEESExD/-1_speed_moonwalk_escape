/**
 * Speed farming and the level curve.
 *
 * "Speed" is the progression currency. Players farm it by MOONWALKING - every
 * stride of glide and every jump adds to a lifetime total, and crossing a
 * level threshold makes the player permanently faster, which is what opens the
 * later stages' gaps.
 *
 * Speed is granted by the SERVER from the movement it observes. The client
 * only ever displays the replicated total; it never awards its own progress.
 */
export interface SpeedConfig {
  /** World units of travel that count as one stride. */
  readonly strideDistance: number;
  /** Strides' worth of Speed granted each time the player leaves the ground. */
  readonly jumpBonusStrides: number;
  /**
   * Largest distance the server will credit from a single simulated step.
   *
   * Expressed as a multiple of the step's own maximum honest travel, so it
   * scales with the player's authoritative speed instead of throttling a fast
   * player back to a beginner's cap. A teleport still pays nothing.
   */
  readonly creditSlack: number;
  /** Speed needed to go from level 1 to level 2. */
  readonly baseRequirement: number;
  /** Each level costs this much more than the one before. */
  readonly growth: number;
}

/**
 * Tuned against the reference art: level 52 sits at roughly 450K lifetime
 * Speed with about 36K needed for the next level, which is exactly what
 * `baseRequirement` 650 and `growth` 1.082 produce.
 */
export const SPEED: SpeedConfig = {
  strideDistance: 2,
  jumpBonusStrides: 2,
  creditSlack: 1.6,
  baseRequirement: 650,
  growth: 1.082,
};

/** Speed needed to advance FROM `level` to the next one. */
export const speedForNextLevel = (level: number): number => {
  const step = Math.max(1, Math.floor(level));
  return Math.round(SPEED.baseRequirement * SPEED.growth ** (step - 1));
};

/** Where a lifetime Speed total sits on the level curve. */
export interface LevelProgress {
  /** Current level. Everyone starts at 1. */
  readonly level: number;
  /** Speed earned toward the next level. */
  readonly into: number;
  /** Speed needed for the next level. */
  readonly required: number;
  /** 0..1 fill for the level bar. */
  readonly fraction: number;
  /** True when the level cap has been reached and the bar is full. */
  readonly capped: boolean;
}

/**
 * Resolve a lifetime Speed total into a level and a bar position.
 *
 * Closed-form rather than a loop: the curve is geometric, and at 450K Speed a
 * per-level loop would run fifty times per HUD update for an answer algebra
 * gives directly. The loop that follows only ever corrects a floating-point
 * boundary by one level either way.
 */
export const resolveLevel = (totalSpeed: number, levelCap: number): LevelProgress => {
  const cap = Math.max(1, Math.floor(levelCap));
  const total = Number.isFinite(totalSpeed) ? Math.max(0, totalSpeed) : 0;

  // Cumulative cost of reaching level L is base * (g^(L-1) - 1) / (g - 1).
  const g = SPEED.growth;
  const base = SPEED.baseRequirement;
  const ratio = (total * (g - 1)) / base + 1;
  let level = Math.floor(Math.log(Math.max(ratio, 1)) / Math.log(g)) + 1;
  level = Math.max(1, Math.min(level, cap));

  // Rounding in `speedForNextLevel` means the closed form can be a level out
  // at a boundary. Two cheap corrections settle it exactly.
  while (level > 1 && totalSpeedToReach(level) > total) level -= 1;
  while (level < cap && totalSpeedToReach(level + 1) <= total) level += 1;

  if (level >= cap) {
    const required = speedForNextLevel(cap);
    return { level: cap, into: required, required, fraction: 1, capped: true };
  }

  const required = speedForNextLevel(level);
  const into = total - totalSpeedToReach(level);
  return {
    level,
    into,
    required,
    fraction: required > 0 ? Math.min(Math.max(into / required, 0), 1) : 0,
    capped: false,
  };
};

/** Cumulative Speed needed to have REACHED `level`. Level 1 costs nothing. */
export const totalSpeedToReach = (level: number): number => {
  const target = Math.max(1, Math.floor(level));
  if (target <= 1) return 0;
  // Summed rather than closed-form so it agrees exactly with the rounded
  // per-level figures the HUD shows. Bounded by the level cap, so this is at
  // most a few hundred iterations and is only called at a level boundary.
  let total = 0;
  for (let i = 1; i < target; i += 1) total += speedForNextLevel(i);
  return total;
};

/**
 * Compact display form used by the HUD: 940, 13.2K, 453.6K, 3.1M.
 *
 * Matches the reference art's casing (an upper-case K) and its one decimal
 * place. Lives in shared so the server can log the figures the player sees.
 */
export const formatSpeed = (value: number): string => {
  const amount = Number.isFinite(value) ? Math.max(0, value) : 0;
  if (amount >= 1_000_000_000_000) return `${(amount / 1_000_000_000_000).toFixed(1)}T`;
  if (amount >= 1_000_000_000) return `${(amount / 1_000_000_000).toFixed(1)}B`;
  if (amount >= 1_000_000) return `${(amount / 1_000_000).toFixed(1)}M`;
  if (amount >= 1_000) return `${(amount / 1_000).toFixed(2).replace(/0$/, '')}K`;
  return Math.floor(amount).toString();
};
