/**
 * The speed upgrade ladder: the floor tiles down the RIGHT of the arena.
 *
 * There are no boots, no pets, no equipment and nothing worn. An upgrade is a
 * TILE the player glides onto, and buying one changes a number and nothing on
 * screen - which is the whole point of doing it this way: the character is a
 * performer in one outfit, and hanging gear off them would fight the look the
 * game is built around.
 *
 * Pure data. Adding an eleventh tier is one entry here and nothing more: it
 * gets a tile in the arena, a price label and a place in the ladder
 * automatically, with no server case statement and no renderer branch.
 */
export interface SpeedTier {
  /** 1-based slot. Also the bit index in the owned mask, and the tile's place. */
  readonly slot: number;
  readonly name: string;
  /**
   * Speed granted per stride of travel.
   *
   * THE reason to buy a tile. Speed is the progression currency, level follows
   * from it and level drives how fast the player actually moves, so a better
   * tile is a faster climb rather than an instant boost.
   */
  readonly speedPerStep: number;
  /** Wins the tile costs. Deducted by the Wallet, once. */
  readonly winsRequired: number;
  /**
   * Direct multiplier on movement speed, fed through the ONE shared formula.
   *
   * Deliberately gentle. Movement is already multiplied by level and by
   * rebirth, and a steep third axis puts a mid-game player through the course
   * faster than its obstacles can be read.
   */
  readonly moveBonus: number;
  /** Multiplier on jump velocity, gentler still. */
  readonly jumpBonus: number;
  /** Tile colour, as a hex number. Presentation only. */
  readonly colour: number;
  /** Neon trim colour for the tile's edge glow. Presentation only. */
  readonly glow: number;
}

/**
 * The ladder.
 *
 * `speedPerStep` roughly triples per rung while the price climbs faster, so a
 * tile is always affordable a little after it becomes worth wanting. The first
 * is FREE and owned from the start - a player with no tile at all would farm
 * nothing, which is not a difficulty curve, it is a stopped game.
 */
export const SPEED_TIERS: readonly SpeedTier[] = [
  { slot: 1, name: 'Rookie', speedPerStep: 1, winsRequired: 0, moveBonus: 1, jumpBonus: 1, colour: 0x3d4b6b, glow: 0x7fd7ff },
  { slot: 2, name: 'Groove', speedPerStep: 3, winsRequired: 5, moveBonus: 1.04, jumpBonus: 1, colour: 0x5a2f7a, glow: 0xc06bff },
  { slot: 3, name: 'Spotlight', speedPerStep: 9, winsRequired: 40, moveBonus: 1.08, jumpBonus: 1.02, colour: 0x7a2f5a, glow: 0xff6bc0 },
  { slot: 4, name: 'Sequin', speedPerStep: 26, winsRequired: 120, moveBonus: 1.12, jumpBonus: 1.03, colour: 0x2f5a7a, glow: 0x6bc0ff },
  { slot: 5, name: 'Platinum', speedPerStep: 75, winsRequired: 600, moveBonus: 1.17, jumpBonus: 1.05, colour: 0x6b7280, glow: 0xe8f0ff },
  { slot: 6, name: 'Neon', speedPerStep: 210, winsRequired: 3_000, moveBonus: 1.22, jumpBonus: 1.06, colour: 0x1f6b52, glow: 0x4dffc3 },
  { slot: 7, name: 'Disco', speedPerStep: 600, winsRequired: 18_000, moveBonus: 1.28, jumpBonus: 1.08, colour: 0x7a5a1f, glow: 0xffd24d },
  { slot: 8, name: 'Superstar', speedPerStep: 1_700, winsRequired: 90_000, moveBonus: 1.34, jumpBonus: 1.1, colour: 0x7a2f2f, glow: 0xff7a4d },
  { slot: 9, name: 'Icon', speedPerStep: 5_000, winsRequired: 400_000, moveBonus: 1.41, jumpBonus: 1.12, colour: 0x3a2f7a, glow: 0x9d7aff },
  { slot: 10, name: 'Legend', speedPerStep: 15_000, winsRequired: 1_500_000, moveBonus: 1.5, jumpBonus: 1.15, colour: 0x111827, glow: 0xffffff },
];

/** The tier every player starts with. Free, and owned before the first step. */
export const STARTER_TIER_SLOT = 1;

/** Bitmask a fresh profile owns: the starter and nothing else. */
export const INITIAL_OWNED_TIERS = 1 << (STARTER_TIER_SLOT - 1);

/** Fallback so an unknown slot can never mean "no income". */
const FALLBACK = SPEED_TIERS[0] as SpeedTier;

/** The tier in a slot, or the starter for anything unrecognised. */
export const tierForSlot = (slot: number): SpeedTier => {
  const at = Math.floor(slot);
  return SPEED_TIERS.find((tier) => tier.slot === at) ?? FALLBACK;
};

/** True when the mask holds this slot. */
export const ownsTier = (mask: number, slot: number): boolean => {
  const at = Math.floor(slot);
  if (at < 1 || at > 32) return false;
  return (mask & (1 << (at - 1))) !== 0;
};

/** The mask with this slot added. */
export const withTier = (mask: number, slot: number): number => {
  const at = Math.floor(slot);
  if (at < 1 || at > 32) return mask;
  return mask | (1 << (at - 1));
};

/**
 * The best tier a mask holds.
 *
 * The equipped tier is always the highest OWNED one, which is what makes a
 * purchase incapable of downgrading anybody: buying tier 4 while holding tier
 * 7 changes the mask and nothing else.
 */
export const bestTier = (mask: number): SpeedTier => {
  let best = FALLBACK;
  for (const tier of SPEED_TIERS) {
    if (ownsTier(mask, tier.slot)) best = tier;
  }
  return best;
};
