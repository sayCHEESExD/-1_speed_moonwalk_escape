/**
 * A player's APPEARANCE, as it travels between the two halves of the game.
 *
 * Bloxity owns what a player looks like. The client reads their equipped items
 * and proportions out of the SDK, the server replicates them to everyone else,
 * and every client dresses every character from the same record - so the player
 * you see moonwalking past is wearing what they actually chose on bloxity.io.
 *
 * Why this is here rather than in the client: the numbers are an AGREEMENT.
 * The server clamps what it is told before replicating it, and the client
 * clamps the sliders it offers; two copies of the ranges would be two
 * agreements, and the one on the wire would be whichever was updated last.
 *
 * What is NOT here: anything progression touches. A look is pure presentation,
 * which is exactly why the server is willing to take one from a client at all -
 * there is nothing to win by lying about a hat. Ids are laundered rather than
 * trusted (`sanitiseAvatarLook`), because a string from a client ends up in a
 * URL.
 */

/** The nine cosmetic slots Bloxity dresses a character in. */
export const AVATAR_SLOTS = [
  'hat',
  'back',
  'skin',
  'head',
  'torso',
  'armL',
  'armR',
  'legL',
  'legR',
] as const;

export type AvatarSlot = (typeof AVATAR_SLOTS)[number];

/** Equipped item id per slot. `''` means nothing equipped in that slot. */
export type AvatarItems = Readonly<Record<AvatarSlot, string>>;

/** Every proportion is a multiplier, and 1 is Bloxity's own default. */
export interface AvatarProportions {
  readonly height: number;
  readonly shoulderWidth: number;
  readonly armLength: number;
  readonly legOffsetX: number;
  readonly torsoScaleX: number;
  readonly neckHeight: number;
  readonly headScale: number;
}

export const DEFAULT_PROPORTIONS: AvatarProportions = {
  height: 1,
  shoulderWidth: 1,
  armLength: 1,
  legOffsetX: 1,
  torsoScaleX: 1,
  neckHeight: 1,
  headScale: 1,
};

/** The documented clamp for each proportion. The sliders and the server share it. */
export const PROPORTION_RANGES: Readonly<
  Record<keyof AvatarProportions, readonly [number, number]>
> = {
  height: [0.5, 1.6],
  shoulderWidth: [0.5, 1.5],
  armLength: [0.05, 3],
  legOffsetX: [-0.7, 5],
  torsoScaleX: [0.3, 2],
  neckHeight: [0.94, 1.2],
  headScale: [0.3, 2.6],
};

export const EMPTY_ITEMS: AvatarItems = {
  hat: '',
  back: '',
  skin: '',
  head: '',
  torso: '',
  armL: '',
  armR: '',
  legL: '',
  legR: '',
};

/**
 * One character's whole appearance.
 *
 * `bloxity` is the flag that decides which BODY is drawn, and it is not the
 * same question as "is anything equipped". A player who has never changed a
 * thing still has a Bloxity DEFAULT avatar, and that default is Bloxity's
 * body wearing Bloxity's default skin - not this game's bundled character.
 * The bundled one is the fallback for someone Bloxity cannot describe at all:
 * the SDK blocked, offline, or missing.
 */
export interface AvatarLook {
  readonly bloxity: boolean;
  readonly items: AvatarItems;
  readonly proportions: AvatarProportions;
}

/** What a character wears before anything is known about who is inside it. */
export const BUNDLED_LOOK: AvatarLook = {
  bloxity: false,
  items: EMPTY_ITEMS,
  proportions: DEFAULT_PROPORTIONS,
};

/**
 * Whether an id names a real item.
 *
 * Bloxity spells "nothing equipped" four ways - `'-1'`, `''`, the literal
 * string `'undefined'` and `null` - and every one of them turns into a
 * guaranteed 404 if it reaches a CDN URL.
 */
export const isEquippedId = (id: string | null | undefined): id is string =>
  id != null && id !== '' && id !== '-1' && id !== 'undefined';

/** Item ids are hex object ids in practice; this is the widest safe spelling. */
const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

const clamp = (value: unknown, [min, max]: readonly [number, number]): number => {
  const numeric = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numeric)) return 1;
  return Math.min(max, Math.max(min, numeric));
};

/**
 * Launder an appearance that came off the wire.
 *
 * Applied by the SERVER to anything a client sends and by the client to
 * anything it reads back, so a malformed or hostile record can never become a
 * URL, a huge string in replicated state, or a character scaled to the size of
 * the arena. Unknown slots are dropped; a slot whose id is not a plain id is
 * simply unequipped, which renders as the default part rather than as an error.
 */
export const sanitiseAvatarLook = (value: unknown): AvatarLook => {
  const source = (value ?? {}) as Partial<AvatarLook> & Record<string, unknown>;
  const rawItems = (source.items ?? {}) as Record<string, unknown>;
  const items: Record<AvatarSlot, string> = { ...EMPTY_ITEMS };
  for (const slot of AVATAR_SLOTS) {
    const id = rawItems[slot];
    items[slot] = typeof id === 'string' && isEquippedId(id) && ID_PATTERN.test(id) ? id : '';
  }

  const rawProportions = (source.proportions ?? {}) as Record<string, unknown>;
  const proportions = {} as Record<keyof AvatarProportions, number>;
  for (const key of Object.keys(DEFAULT_PROPORTIONS) as (keyof AvatarProportions)[]) {
    proportions[key] = clamp(rawProportions[key], PROPORTION_RANGES[key]);
  }

  return { bloxity: source.bloxity === true, items, proportions };
};

/** Whether two looks would draw the same character. */
export const looksMatch = (a: AvatarLook, b: AvatarLook): boolean => {
  if (a.bloxity !== b.bloxity) return false;
  for (const slot of AVATAR_SLOTS) {
    if (a.items[slot] !== b.items[slot]) return false;
  }
  for (const key of Object.keys(DEFAULT_PROPORTIONS) as (keyof AvatarProportions)[]) {
    if (a.proportions[key] !== b.proportions[key]) return false;
  }
  return true;
};
