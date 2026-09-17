/**
 * Where Bloxity's avatar assets live.
 *
 * These are the URL patterns from the SDK spec and from the canonical reference
 * page (`https://bloxity.io/test-game.html`, its `getItemUrls`), and the base
 * body and default skin were confirmed to serve from the live CDN before being
 * written here. Callers must only ask for a slot whose id passes
 * `isEquippedId` - an unequipped slot has no asset, and building a URL out of
 * `'-1'` is a guaranteed 404.
 */
export const AVATAR_CDN = 'https://static.bloxity.io/avatars';

/** The base body. Its skeleton carries the same twelve bone names `PlayerRig` binds. */
export const PLAYER_GLB_URL = `${AVATAR_CDN}/player.glb`;

/** The skin Bloxity's own renderer falls back to when none is equipped. */
export const DEFAULT_SKIN_ID = '0';

/**
 * The portrait shown when a player has no picture of their own.
 *
 * DRAWN HERE, not fetched. The reference page falls back to
 * `static.bloxity.io/img/pfps/0.png`, and that URL answers 404 - so using it
 * would put a broken-image icon next to somebody's name, which is worse than
 * having no picture at all. A neutral disc says "no picture" without
 * pretending to be one, and costs no request.
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

export const hatUrls = (id: string): { mesh: string; texture: string } => ({
  mesh: `${AVATAR_CDN}/items/hats/${id}.obj`,
  texture: `${AVATAR_CDN}/textures/hats/${id}.png`,
});

export const backUrls = (id: string): { mesh: string; texture: string } => ({
  mesh: `${AVATAR_CDN}/items/back/${id}.obj`,
  texture: `${AVATAR_CDN}/textures/back/${id}.png`,
});

export const skinUrl = (id: string): string => `${AVATAR_CDN}/skins/${id}.png`;

export const iconUrl = (id: string): string => `${AVATAR_CDN}/icons/${id}.png`;

/** Head and torso are single meshes. */
export const partUrl = (type: 'head' | 'torso', id: string): string =>
  `${AVATAR_CDN}/parts/${type}/${id}.glb`;

/** Arms and legs are authored as a left and a right under one id. */
export const pairedPartUrl = (type: 'arms' | 'legs', id: string, side: 'L' | 'R'): string =>
  `${AVATAR_CDN}/parts/${type}/${id}_${side}.glb`;

/**
 * The catalogue's own asset paths for an item, or null.
 *
 * WHY THIS EXISTS: the id-based patterns above are right for 498 of the 500
 * items in Bloxity's public catalogue, checked item by item - but not all of
 * them. The Default Skin's file is `skins/0.png`, and at least one back item
 * ("Flamingo") keeps its texture under a different filename entirely. So the
 * catalogue's `assetPaths` are used when they can be had, and the spec pattern
 * is the FALLBACK rather than the only answer.
 *
 * `GET /v1/avatar/items/{id}` is public (appearance is public data). The
 * promise is cached per id, including a failed lookup, so two slots wearing
 * the same item cost one request and a missing item is not retried in a loop.
 */
interface ItemPaths {
  readonly mesh?: string;
  readonly meshL?: string;
  readonly meshR?: string;
  readonly texture?: string;
}

const CATALOGUE_API = 'https://api.bloxity.io/v1/avatar/items';
const STATIC_HOST = 'https://static.bloxity.io';
const catalogue = new Map<string, Promise<ItemPaths | null>>();

const catalogPaths = (id: string): Promise<ItemPaths | null> => {
  const cached = catalogue.get(id);
  if (cached) return cached;
  const request = fetch(`${CATALOGUE_API}/${encodeURIComponent(id)}`, {
    signal: AbortSignal.timeout(6000),
  })
    .then(async (response) => {
      if (!response.ok) return null;
      const body = (await response.json()) as {
        assetPaths?: ItemPaths;
        item?: { assetPaths?: ItemPaths };
      };
      return body.assetPaths ?? body.item?.assetPaths ?? null;
    })
    .catch(() => null);
  catalogue.set(id, request);
  return request;
};

const fromCdn = (path: string): string => (path.startsWith('http') ? path : `${STATIC_HOST}${path}`);

/** Mesh and texture for a hat or back item: catalogue first, spec pattern as fallback. */
export const resolveItemUrls = async (
  slot: 'hat' | 'back',
  id: string,
): Promise<{ mesh: string; texture: string }> => {
  const fallback = slot === 'hat' ? hatUrls(id) : backUrls(id);
  const paths = await catalogPaths(id);
  return {
    mesh: paths?.mesh ? fromCdn(paths.mesh) : fallback.mesh,
    texture: paths?.texture ? fromCdn(paths.texture) : fallback.texture,
  };
};

/** A skin's texture: catalogue first, spec pattern as fallback. The default needs no lookup. */
export const resolveSkinUrl = async (id: string): Promise<string> => {
  if (id === DEFAULT_SKIN_ID) return skinUrl(id);
  const paths = await catalogPaths(id);
  return paths?.texture ? fromCdn(paths.texture) : skinUrl(id);
};

/**
 * The mesh in `player.glb` each part replaces.
 *
 * Names taken from the reference page's `PART_MESH_NAMES`.
 */
export const PART_MESH_NAMES = {
  head: 'default_head',
  torso: 'default_torso',
  arm_L: 'default_arm_L',
  arm_R: 'default_arm_R',
  leg_L: 'default_leg_L',
  leg_R: 'default_leg_R',
} as const;

/**
 * How tall `player.glb` stands in its own units.
 *
 * This game's character is `PLAYER_HEIGHT` (3.2) world units, so the Bloxity
 * body is scaled by 3.2 / 6.4 to be interchangeable with `player.fbx`. It is
 * also the reference scale for hats and back items: the reference page parents
 * a hat at (0, 0.8, 0) on the head bone of an unscaled `player.glb`, and those
 * numbers are converted through this ratio rather than retuned per body.
 */
export const BLOXITY_MODEL_HEIGHT = 6.4;
