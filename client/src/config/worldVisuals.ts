/**
 * The palette, and the one presentation constant gameplay is allowed to see.
 *
 * COLOUR ONLY. Every world coordinate lives in `@moonwalk/shared`'s course
 * config, so this file can be re-themed without moving a single collider.
 *
 * The look is PERMANENT NIGHT: a black-blue city, a deep red carpet, and
 * everything else picked out in neon. There is no daylight state and no day
 * palette - a "night mode" that can be turned off is two art directions to
 * keep in step, and this game only ever has one.
 *
 * Not one image file is used for the world. Every texture is drawn on a canvas
 * at runtime by `WorldTextures`, so the whole style costs a few kilobytes of
 * code and nothing against the 12 MB budget.
 */
export const PALETTE = {
  /** The red carpet - the single most-seen colour in the game. */
  carpet: '#8e1220',
  carpetWeave: '#a4172a',
  /** The arena's runner: a shade brighter, so the spawn reads as the event. */
  carpetBright: '#b31730',
  carpetBrightWeave: '#cc1e3a',

  /** The tiled plaza the arena is laid on. */
  plaza: '#161b2c',
  plazaLine: '#2c3350',

  /** Dark stage masonry and scaffolding. */
  stage: '#1b2133',
  stageDark: '#0d1120',

  /** Brushed chrome: risers, truss legs, treadmill frames. */
  chrome: '#5b6479',
  chromeDark: '#3a4054',
  chromeSpeck: 'rgba(255,255,255,0.10)',

  /** Catwalk planks: matte black board with a lit edge. */
  plank: '#232838',
  plankDark: '#161a26',
  plankSpeck: 'rgba(255,255,255,0.06)',

  /** Lit dance-floor glass. */
  glass: '#2a1b4d',
  glassAlt: '#4c2b8a',

  /** The city beyond the walls. */
  building: 0x0e1322,
  buildingAlt: 0x141a2e,
  window: 0xffd98a,
  windowCool: 0x8fd4ff,

  /** The night sky and the fog that sells its depth. */
  sky: 0x05070f,
  fog: 0x080b16,

  /** The bottom of the world: a lit service level. */
  pitFloor: 0x0a0d18,

  /** Neon. These five are the whole accent language of the game. */
  neonPink: 0xff2d78,
  neonCyan: 0x2dd4ff,
  neonGold: 0xffd24d,
  neonViolet: 0xa855f7,
  neonGreen: 0x4dffc3,

  /** Velvet-rope brass and its cord. */
  brass: 0xd9a441,
  rope: 0x6b0f1c,

  /** A disco ball: chrome facets, with a hot white sparkle. */
  discoBall: 0xd8e4ff,
  discoFacet: 0xffffff,

  /** The warning patch a falling ball throws on the floor. */
  impactWarn: 0xff2d78,

  /**
   * The leaderboards on the arena's back wall.
   *
   * Deliberately the LIGHTEST surface in the game. Everything else here is a
   * night scene, and a board is a thing the player walks up to and reads - so
   * it is lit like a departures screen rather than dressed like the street.
   */
  boardFrame: 0x2a3350,
  boardFrameDark: 0x1a2138,
  boardPanel: '#0b1020',
  boardPanelEdge: '#2dd4ff',
  boardHeading: '#ffffff',
  boardStripe: 'rgba(45,212,255,0.07)',
  boardInk: 'rgba(45,212,255,0.22)',
  boardName: '#cfe6ff',
  boardValue: '#ffe14d',

  /** The treadmill belt. */
  belt: '#0f1420',
  beltMark: '#2dd4ff',
  treadmillFrame: 0x39415a,
  treadmillFrameDark: 0x232939,
  treadmillScreen: 0x0a0f1a,
} as const;

/** Fog distances. Near enough that the city fades, far enough to see a stage. */
export const WORLD_FOG = {
  near: 70,
  far: 620,
} as const;

/**
 * THE moonwalk, expressed as a single number.
 *
 * The simulation faces the player the way they are TRAVELLING, exactly as it
 * would for any character. This offset then turns the model half a turn on top
 * of that, so the body faces the opposite way to the movement - which is what
 * a moonwalk is: the performer glides backwards while facing forwards, and
 * pressing W therefore sends the character physically backwards down the
 * carpet.
 *
 * It lives here, in presentation, and NOT in `stepPlayer`, and that placement
 * is the whole design. Physics, collision, the camera's idea of forward and
 * the server's authoritative yaw are all completely ordinary; the illusion is
 * one rotation applied to a visual node at the very end. Putting the reversal
 * in the simulation would mean the client and the server had to agree about a
 * dance move, which is precisely the sort of thing that ends up agreed on one
 * side only.
 *
 * A happy consequence: with a chase camera behind the player, a character
 * facing backwards is facing the CAMERA. The hat, the glasses and the raised
 * hand are in shot for the whole run, which is the shot the reference art is.
 */
export const PLAYER_MODEL_YAW_OFFSET = Math.PI;

/** Scenery generation, for the city that lines the whole course. */
export const SCENERY = {
  /** Z between one block of buildings and the next. */
  blockSpacingZ: 34,
  /** How far past the corridor wall the near facade stands. */
  offsetX: 16,
  /** Building footprint and height range. Deterministic, never random. */
  minWidth: 14,
  maxWidth: 26,
  minHeight: 34,
  maxHeight: 96,
  /** How many rows of buildings recede from the course on each side. */
  rows: 3,
  /** Extra distance between one row and the next. */
  rowDepth: 30,
} as const;
