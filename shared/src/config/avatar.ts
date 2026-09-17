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

/**
 * How far a proportion is allowed to move a character, and where it stops.
 *
 * Bloxity's sliders are built for a viewer where nothing has to run a course:
 * `height` alone spans 0.5 to 1.6, which is a player a third the size of the
 * one standing beside them. Rendering those literally is what put microscopic
 * and gigantic players on the carpet.
 *
 * So every proportion is TEMPERED rather than either ignored or obeyed
 * blindly: the deviation from 1 is scaled by an influence, then clamped.
 * Everyone keeps their own build, the differences between two avatars stay
 * visible and in the same ORDER Bloxity's own viewer shows them in, and every
 * player stays a size this game's camera, collision box and nameplates can
 * work with.
 *
 * It lives in `shared/` because it is the rule that decides whether a player
 * is physically usable, and `verify:progression` asserts the bounds hold for
 * every value a slider can produce - including the ones a hostile client can
 * send.
 */
export const PROPORTION_TEMPER: Readonly<
  Record<keyof AvatarProportions, { readonly influence: number; readonly min: number; readonly max: number }>
> = {
  height: { influence: 0.55, min: 0.75, max: 1.3 },
  headScale: { influence: 0.8, min: 0.6, max: 1.8 },
  armLength: { influence: 0.8, min: 0.4, max: 1.8 },
  // Tempered harder than the rest: shoulder width moves the arm OFFSETS, and
  // past about a third wider the arms visibly leave the chest behind. The
  // alternative - scaling the chest bone, which the arms hang off - widens the
  // head with them, because the neck hangs off it too.
  shoulderWidth: { influence: 0.6, min: 0.7, max: 1.35 },
  torsoScaleX: { influence: 1, min: 0.4, max: 1.8 },
  neckHeight: { influence: 0.8, min: 0.9, max: 1.25 },
  legOffsetX: { influence: 0.35, min: 0.4, max: 2.2 },
};

/**
 * The multiplier actually applied for one proportion.
 *
 * Also the last guard against a malformed value ever reaching a scale: a
 * zero, a negative, a NaN or a missing field all resolve to 1 rather than
 * collapsing a character to a point or turning its matrix into NaNs - which
 * in three.js does not throw, it simply stops drawing the player.
 */
export const temperProportion = (
  value: number | undefined,
  key: keyof AvatarProportions,
): number => {
  const { influence, min, max } = PROPORTION_TEMPER[key];
  /*
   * Only a NON-NUMBER falls back to 1.
   *
   * Zero and negatives are put through the same arithmetic and land on `min`,
   * which is what makes the curve MONOTONIC: a bigger slider value is never a
   * smaller character. Treating them as 1 instead - which this did at first -
   * puts a step in the middle of `legOffsetX`, whose own range legitimately
   * starts below zero. `min` is comfortably above zero for every proportion,
   * so nothing here can collapse a character however the number arrived.
   */
  const raw = typeof value === 'number' && Number.isFinite(value) ? value : 1;
  return Math.min(max, Math.max(min, 1 + (raw - 1) * influence));
};

/**
 * The flat shape a look takes on the wire.
 *
 * A Colyseus schema has no nested objects to speak of, so a look travels as
 * seventeen fields. This is the one place that knows that, and both halves
 * read it back through `avatarLookFrom`.
 */
export type FlatAvatarLook = Partial<Record<AvatarSlot, string>> &
  Partial<Record<keyof AvatarProportions, number>> & { bloxity?: boolean };

/** Fold a flat, replicated look back into an `AvatarLook`, sanitised. */
export const avatarLookFrom = (flat: FlatAvatarLook | undefined): AvatarLook => {
  if (!flat) return BUNDLED_LOOK;
  const items: Record<string, unknown> = {};
  for (const slot of AVATAR_SLOTS) items[slot] = flat[slot];
  const proportions: Record<string, unknown> = {};
  for (const key of Object.keys(DEFAULT_PROPORTIONS) as (keyof AvatarProportions)[]) {
    proportions[key] = flat[key];
  }
  return sanitiseAvatarLook({ bloxity: flat.bloxity === true, items, proportions });
};

/**
 * Bloxity's OWN portrait for a look.
 *
 * Their service renders a headshot for any avatar and serves it from a URL
 * built out of that avatar - and this is their scheme, lifted from the SDK
 * bundle rather than guessed: a skin, then the hat and back item if worn, then
 * the body parts and the seven proportions when any of them differs from the
 * default. Each proportion is printed with `f` where the decimal point goes.
 *
 * Why derive it at all, when a signed-in account usually HAS a `pfp`: because
 * the look is replicated and the portrait is not, so every player in the room
 * can be given their own correct portrait from what is already on the wire -
 * no second identity field, no 3D render to make a thumbnail, and no chance of
 * one player's icon landing on another, because the URL is a pure function of
 * that player's own look. An account's real `pfp` still wins when there is one.
 */
export const portraitUrlFor = (look: AvatarLook): string => {
  const id = (value: string): string => (isEquippedId(value) ? value : '0');
  const items = look.items;

  let key = `s${id(items.skin)}`;
  if (isEquippedId(items.hat)) key += `_h${items.hat}`;
  if (isEquippedId(items.back)) key += `_b${items.back}`;

  const head = id(items.head);
  const armL = id(items.armL);
  const armR = id(items.armR);
  const legL = id(items.legL);
  const legR = id(items.legR);
  const torso = id(items.torso);
  const wearsParts = [head, armL, armR, legL, legR, torso].some((value) => value !== '0');

  const ordered = PORTRAIT_PROPORTION_ORDER.map((name) => look.proportions[name]);
  const reshaped = ordered.some((value) => Math.abs(value - 1) > 1e-4);

  if (wearsParts || reshaped) {
    key += `_hd${head}_aL${armL}_aR${armR}_lL${legL}_lR${legR}_to${torso}`;
    key += `_p${ordered.map(portraitNumber).join('-')}`;
  }
  return `${PORTRAIT_BASE}/${key}.png?width=128&quality=85&v=2`;
};

/** Where Bloxity renders portraits. */
const PORTRAIT_BASE = 'https://static.bloxity.io/img/pfps';

/** The order the portrait key prints proportions in. Theirs, not ours. */
const PORTRAIT_PROPORTION_ORDER: readonly (keyof AvatarProportions)[] = [
  'height',
  'shoulderWidth',
  'armLength',
  'legOffsetX',
  'torsoScaleX',
  'neckHeight',
  'headScale',
];

/** `1` becomes `1f0` and `1.25` becomes `1f25` - a decimal point is not URL-safe. */
const portraitNumber = (value: number): string => {
  const text = Number.parseFloat(value.toFixed(4)).toString();
  return text.includes('.') ? text.replace('.', 'f') : `${text}f0`;
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
