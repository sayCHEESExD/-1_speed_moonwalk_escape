import { logger } from '../util/logger.js';

const SCOPE = 'bloxity/assets';

/**
 * Where Bloxity's avatar assets live.
 *
 * NOT invented, and not guessed from a naming pattern: both hosts are the ones
 * the SDK this game already loads uses itself - it resolves every asset
 * through `https://static.bloxity.io${path}` and fetches its catalogue from
 * `https://api.bloxity.io`.
 *
 * The important consequence, and the whole reason this file was rewritten:
 * NOTHING here builds an asset URL out of an id. The catalogue hands back an
 * `assetPaths` object per item and those paths are used verbatim. The id-based
 * patterns that used to live here were right for most items and silently wrong
 * for the rest - a 404 for a part is an avatar missing an arm, and a 404 for a
 * texture is a black head - which is exactly what players were seeing.
 */
const STATIC_BASE = 'https://static.bloxity.io';
const API_BASE = 'https://api.bloxity.io';

/**
 * The base body.
 *
 * The one path that IS a constant, because it is not an item and has no
 * catalogue entry - the SDK loads it by this literal too. Its skeleton carries
 * the same twelve bone names `PlayerRig` binds, which is what lets the
 * moonwalk drive a Bloxity body without knowing it is one.
 */
export const PLAYER_GLB_URL = `${STATIC_BASE}/avatars/player.glb`;

/**
 * The skin worn when a Bloxity player has none equipped.
 *
 * The SDK's own fallback: it maps a missing or `'-1'` skin id to `0` and loads
 * `/avatars/skins/0.png`. A Bloxity body with no texture renders white.
 */
export const DEFAULT_SKIN_URL = `${STATIC_BASE}/avatars/skins/0.png`;

/** Resolve a catalogue-supplied path against the asset host. */
export const assetUrl = (path: string): string =>
  path.startsWith('http') ? path : `${STATIC_BASE}${path}`;

/**
 * The portrait shown when a player has no picture of their own.
 *
 * DRAWN HERE, not fetched. Bloxity's own placeholder
 * (`static.bloxity.io/img/pfps/0.png`, which its reference page still uses)
 * answers 404, so pointing at it would put a broken-image icon beside
 * somebody's name. A neutral disc says "no picture" without pretending to be
 * one, and costs no request.
 */
export const DEFAULT_PFP_URL =
  'data:image/svg+xml;utf8,' +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">' +
      '<circle cx="32" cy="32" r="32" fill="%23241a3a"/>' +
      '<circle cx="32" cy="25" r="11" fill="%233b2c5c"/>' +
      '<path d="M8 64c0-13 11-21 24-21s24 8 24 21z" fill="%233b2c5c"/>' +
      '</svg>',
  );

/** The catalogue's own item shape, narrowed to what a renderer needs. */
export interface BloxityItem {
  readonly id: string;
  readonly type?: 'skin' | 'hat' | 'back' | 'part';
  /** Present on `part` items only. */
  readonly partSlot?: 'head' | 'torso' | 'arms' | 'legs';
  /**
   * On a HAT: the head this hat insists on being worn with.
   *
   * Not a hiding flag, which is the natural but wrong reading of the name.
   * Bloxity's customiser applies it as `equipped.headId = item.forceHeadId`,
   * and its renderer treats a head of `'-1'` as "put the DEFAULT head back" -
   * so a helmet modelled around the stock head declares `'-1'`, and a custom
   * head worn under it pokes straight through the helmet.
   */
  readonly forceHeadId?: string | null;
  readonly assetPaths?: {
    /** Single mesh: a hat, a back item, a head or a torso. */
    readonly mesh?: string;
    /** Paired meshes: arms and legs are authored as a left and a right. */
    readonly meshL?: string;
    readonly meshR?: string;
    readonly texture?: string;
    readonly icon?: string;
  };
}

/**
 * The item cache.
 *
 * Keyed by id and holding the PROMISE rather than the result, which is what
 * makes two players wearing the same hat share one request instead of racing
 * to make two. A failed lookup is cached as `null` deliberately: an id the
 * catalogue does not know will not start knowing it because another player
 * wore it, and retrying per player per join is how a missing item becomes a
 * request storm.
 */
const items = new Map<string, Promise<BloxityItem | null>>();

/**
 * The same items once they have actually resolved.
 *
 * A synchronous window onto the cache, for the one caller that has to decide
 * something DURING a frame rather than a tick later: the avatar needs to know
 * whether a hat forces a head before it picks a body, and awaiting there would
 * make a re-dress asynchronous for every player who is not wearing one.
 */
const resolved = new Map<string, BloxityItem | null>();

/**
 * What the catalogue already knows about an item, without waiting.
 *
 * `undefined` means "not asked yet", which is deliberately distinct from the
 * `null` that means "asked, and there is no such item" - only the first of
 * those is worth scheduling a second look for.
 */
export const peekItem = (id: string): BloxityItem | null | undefined =>
  id ? resolved.get(id) : null;

/**
 * Look one item up in Bloxity's public catalogue.
 *
 * `GET /v1/avatar/items/{id}` - the per-item route, so a player wearing three
 * things costs three small requests rather than a walk through a catalogue of
 * hundreds. No authentication: appearance is public data, which is the whole
 * reason a REMOTE player's look can be resolved from an id at all.
 */
export const describeItem = (id: string): Promise<BloxityItem | null> => {
  if (!id) return Promise.resolve(null);

  const cached = items.get(id);
  if (cached) return cached;

  const request = fetch(`${API_BASE}/v1/avatar/items/${encodeURIComponent(id)}`, {
    signal: AbortSignal.timeout(8000),
  })
    .then(async (response) => {
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const body = (await response.json()) as BloxityItem & { item?: BloxityItem };
      const item = body.item ?? body;
      resolved.set(id, item);
      return item;
    })
    .catch((error: unknown) => {
      logger.warn(SCOPE, `item ${id} could not be resolved: ${String(error)}`);
      resolved.set(id, null);
      return null;
    });

  items.set(id, request);
  return request;
};

/**
 * Which mesh in `player.glb` a part replaces, and which path supplies it.
 *
 * The mesh names are the SDK's own. Arms and legs are PAIRS - ONE catalogue
 * item carrying `meshL` and `meshR` - which is why this maps to a list rather
 * than to a single name, and why a left and a right arm are not two lookups.
 */
export const PART_TARGETS: Readonly<
  Record<
    NonNullable<BloxityItem['partSlot']>,
    ReadonlyArray<{ mesh: string; path: 'mesh' | 'meshL' | 'meshR' }>
  >
> = {
  head: [{ mesh: 'default_head', path: 'mesh' }],
  torso: [{ mesh: 'default_torso', path: 'mesh' }],
  arms: [
    { mesh: 'default_arm_L', path: 'meshL' },
    { mesh: 'default_arm_R', path: 'meshR' },
  ],
  legs: [
    { mesh: 'default_leg_L', path: 'meshL' },
    { mesh: 'default_leg_R', path: 'meshR' },
  ],
};

/**
 * How tall `player.glb` stands in its own units.
 *
 * The GLB's bind pose measures 6.4 units head to foot; this game's character
 * is `PLAYER_HEIGHT` (3.2) world units. Halving the Bloxity body is what makes
 * the two interchangeable.
 */
export const BLOXITY_MODEL_HEIGHT = 6.4;
