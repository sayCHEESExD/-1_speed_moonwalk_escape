import {
  CanvasTexture,
  EquirectangularReflectionMapping,
  RepeatWrapping,
  SRGBColorSpace,
  type Texture,
} from 'three';

/**
 * Every texture in the game, drawn at runtime on a canvas.
 *
 * There is not one image file used for the world. The whole neon-night look -
 * the woven red carpet, the tiled plaza, the brushed chrome, the lit dance
 * glass, the scrolling treadmill belts, the building facades and the night sky
 * - costs a few kilobytes of code and nothing at all against the 12 MB budget.
 *
 * Textures are cached and shared: a caller asking twice gets the same GPU
 * upload, so the hundred-odd carpet slabs of a ten-stage course are one
 * texture between them.
 */
export class WorldTextures {
  private readonly cache = new Map<string, Texture>();

  /**
   * The red carpet: a woven pile with a subtle nap.
   *
   * Two crossed sets of fine lines rather than noise. A carpet reads as a
   * WEAVE at any distance, and a speckle reads as dirt.
   */
  carpet(colour: string, weave: string): Texture {
    return this.cached(`carpet:${colour}:${weave}`, () => {
      const size = 128;
      const ctx = context(size);
      ctx.fillStyle = colour;
      ctx.fillRect(0, 0, size, size);

      ctx.strokeStyle = weave;
      ctx.lineWidth = 1;
      for (let i = 0; i < size; i += 4) {
        ctx.globalAlpha = i % 8 === 0 ? 0.5 : 0.24;
        ctx.beginPath();
        ctx.moveTo(i, 0);
        ctx.lineTo(i, size);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(0, i);
        ctx.lineTo(size, i);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;

      // A slight sheen band, so a long runway is not one flat colour.
      const sheen = ctx.createLinearGradient(0, 0, size, size);
      sheen.addColorStop(0, 'rgba(255,255,255,0.05)');
      sheen.addColorStop(0.5, 'rgba(0,0,0,0.06)');
      sheen.addColorStop(1, 'rgba(255,255,255,0.04)');
      ctx.fillStyle = sheen;
      ctx.fillRect(0, 0, size, size);
      return ctx.canvas;
    });
  }

  /**
   * The plaza: large dark tiles with a lit grout line.
   *
   * The grout is what makes the arena floor read as a SURFACE at night rather
   * than as a hole - a flat dark plane with nothing on it has no scale and no
   * horizon, and the player cannot tell how fast they are moving over it.
   */
  tiles(colour: string, line: string): Texture {
    return this.cached(`tiles:${colour}:${line}`, () => {
      const size = 128;
      const ctx = context(size);
      ctx.fillStyle = colour;
      ctx.fillRect(0, 0, size, size);

      ctx.fillStyle = line;
      const cells = 2;
      const step = size / cells;
      for (let i = 0; i <= cells; i += 1) {
        ctx.fillRect(i * step - 1, 0, 2, size);
        ctx.fillRect(0, i * step - 1, size, 2);
      }

      // A soft highlight in one corner of each tile, so the floor catches the
      // neon rather than swallowing it.
      ctx.fillStyle = 'rgba(255,255,255,0.035)';
      for (let ix = 0; ix < cells; ix += 1) {
        for (let iz = 0; iz < cells; iz += 1) {
          ctx.fillRect(ix * step + 4, iz * step + 4, step * 0.4, step * 0.4);
        }
      }
      return ctx.canvas;
    });
  }

  /** Brushed chrome: fine horizontal grain with a couple of bright streaks. */
  chrome(colour: string, dark: string, speck: string): Texture {
    return this.cached(`chrome:${colour}:${dark}:${speck}`, () => {
      const size = 128;
      const ctx = context(size);
      ctx.fillStyle = colour;
      ctx.fillRect(0, 0, size, size);

      ctx.strokeStyle = dark;
      ctx.lineWidth = 1;
      // Deterministic grain - every client must draw the same metal.
      for (let i = 0; i < 90; i += 1) {
        const y = (i * 37) % size;
        ctx.globalAlpha = 0.1 + ((i * 13) % 7) / 30;
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(size, y + (((i * 17) % 5) - 2));
        ctx.stroke();
      }
      ctx.globalAlpha = 1;

      ctx.fillStyle = speck;
      for (let i = 0; i < 40; i += 1) {
        ctx.fillRect((i * 53) % size, (i * 29) % size, 6, 1);
      }
      return ctx.canvas;
    });
  }

  /** Matte board with a lit edge stripe: the catwalk planks. */
  planks(colour: string, dark: string, speck: string): Texture {
    return this.cached(`planks:${colour}:${dark}:${speck}`, () => {
      const size = 128;
      const ctx = context(size);
      ctx.fillStyle = colour;
      ctx.fillRect(0, 0, size, size);

      const boards = 4;
      const boardHeight = size / boards;
      ctx.fillStyle = dark;
      for (let i = 0; i <= boards; i += 1) {
        ctx.fillRect(0, i * boardHeight - 1.5, size, 3);
      }

      ctx.fillStyle = speck;
      for (let i = 0; i < 200; i += 1) {
        ctx.fillRect((i * 53) % size, (i * 29) % size, 2, 2);
      }
      return ctx.canvas;
    });
  }

  /**
   * Lit dance glass: a chequer of two violets with a bright seam.
   *
   * Deliberately high contrast. It is the one floor in the game the player is
   * meant to read the EDGES of at speed, because the panels are separated by
   * real gaps.
   */
  danceGlass(colour: string, alt: string): Texture {
    return this.cached(`glass:${colour}:${alt}`, () => {
      const size = 64;
      const ctx = context(size);
      ctx.fillStyle = colour;
      ctx.fillRect(0, 0, size, size);
      ctx.fillStyle = alt;
      for (let y = 0; y < size; y += 32) {
        for (let x = 0; x < size; x += 32) {
          if (((x + y) / 32) % 2 === 0) ctx.fillRect(x, y, 32, 32);
        }
      }
      ctx.strokeStyle = 'rgba(255,255,255,0.4)';
      ctx.lineWidth = 2;
      ctx.strokeRect(1, 1, size - 2, size - 2);
      return ctx.canvas;
    });
  }

  /** Dark stage masonry: coursed blocks, barely lit. */
  stone(colour: string, dark: string): Texture {
    return this.cached(`stone:${colour}:${dark}`, () => {
      const size = 128;
      const ctx = context(size);
      ctx.fillStyle = colour;
      ctx.fillRect(0, 0, size, size);
      ctx.fillStyle = dark;
      for (let r = 0; r < 4; r += 1) {
        ctx.fillRect(0, r * 32 + 30, size, 2);
        ctx.fillRect((r % 2 === 0 ? 0 : 64) + 30, r * 32, 2, 32);
      }
      for (let i = 0; i < 60; i += 1) {
        ctx.fillRect((i * 53) % size, (i * 29) % size, 3, 3);
      }
      return ctx.canvas;
    });
  }

  /**
   * A building facade: rows of lit and unlit windows.
   *
   * The whole city is this one texture on boxes of different sizes, and
   * `texturedBox` scales the UVs to WORLD size - so a sixty-unit tower and a
   * twenty-unit block get windows the same size rather than each stretching
   * one copy over themselves. That single detail is most of the difference
   * between a skyline and a row of striped crates.
   */
  facade(base: number, warm: number, cool: number): Texture {
    return this.cached(`facade:${base}:${warm}:${cool}`, () => {
      const size = 128;
      const ctx = context(size);
      ctx.fillStyle = hex(base);
      ctx.fillRect(0, 0, size, size);

      const cols = 6;
      const rows = 8;
      const w = size / cols;
      const h = size / rows;
      for (let cx = 0; cx < cols; cx += 1) {
        for (let cy = 0; cy < rows; cy += 1) {
          // Deterministic occupancy: a hash, never Math.random, so every client
          // sees the same city.
          const key = (cx * 73856093) ^ (cy * 19349663);
          const lit = ((key >>> 3) & 7) > 3;
          if (!lit) continue;
          ctx.fillStyle = ((key >>> 6) & 3) === 0 ? hex(cool) : hex(warm);
          ctx.globalAlpha = 0.35 + (((key >>> 8) & 7) / 7) * 0.5;
          ctx.fillRect(cx * w + w * 0.22, cy * h + h * 0.2, w * 0.56, h * 0.5);
        }
      }
      ctx.globalAlpha = 1;
      return ctx.canvas;
    });
  }

  /**
   * The treadmill belt: chevrons that scroll along the belt's length.
   *
   * They point along U, not V. The belt's top face maps U to its long axis, so
   * a chevron drawn pointing "up" the canvas would run ACROSS the machine.
   */
  belt(base: string, mark: string): Texture {
    return this.cached(`belt:${base}:${mark}`, () => {
      const size = 64;
      const ctx = context(size);
      ctx.fillStyle = base;
      ctx.fillRect(0, 0, size, size);
      ctx.fillStyle = mark;
      for (let i = 0; i < 2; i += 1) {
        const at = i * 32;
        ctx.beginPath();
        ctx.moveTo(at + 22, 4);
        ctx.lineTo(at + 4, size / 2);
        ctx.lineTo(at + 22, size - 4);
        ctx.lineTo(at + 28, size - 4);
        ctx.lineTo(at + 10, size / 2);
        ctx.lineTo(at + 28, 4);
        ctx.closePath();
        ctx.fill();
      }
      return ctx.canvas;
    });
  }

  /**
   * A disco ball: a mirrored sphere's worth of facets.
   *
   * Drawn as a grid of tiles with wildly varying brightness, which is exactly
   * what a mirror ball is - and because the ball SPINS, the varying tiles
   * sweep past the light and the whole thing glitters for free.
   */
  discoFacets(base: number, bright: number): Texture {
    return this.cached(`disco:${base}:${bright}`, () => {
      const size = 128;
      const ctx = context(size);
      ctx.fillStyle = hex(base);
      ctx.fillRect(0, 0, size, size);

      const cells = 16;
      const step = size / cells;
      for (let ix = 0; ix < cells; ix += 1) {
        for (let iz = 0; iz < cells; iz += 1) {
          const key = (ix * 73856093) ^ (iz * 19349663);
          const shade = ((key >>> 4) & 15) / 15;
          ctx.fillStyle = shade > 0.72 ? hex(bright) : hex(base);
          ctx.globalAlpha = 0.25 + shade * 0.75;
          ctx.fillRect(ix * step, iz * step, step - 1, step - 1);
        }
      }
      ctx.globalAlpha = 1;
      return ctx.canvas;
    });
  }

  /**
   * The night sky: a deep gradient with a low city glow and a scatter of stars.
   *
   * Equirectangular, so `v` is latitude - 0 is straight up, 0.5 is the horizon.
   * The camera only ever sees a band around the middle, which is why the city
   * glow does its work just above the horizon line and the stars are massed
   * toward the zenith.
   *
   * Used as `scene.background` rather than a dome mesh: three renders it as a
   * true background, which costs no draw call and cannot be culled.
   */
  nightSky(): Texture {
    const texture = this.cached(
      'nightsky',
      () => {
        const width = 1024;
        const height = 512;
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) return canvas;

        const gradient = ctx.createLinearGradient(0, 0, 0, height);
        gradient.addColorStop(0, '#02030a');
        gradient.addColorStop(0.32, '#050813');
        gradient.addColorStop(0.48, '#0b1024');
        // The city glow: a warm bruise right at the horizon.
        gradient.addColorStop(0.55, '#241436');
        gradient.addColorStop(0.6, '#3a1740');
        gradient.addColorStop(0.68, '#12111f');
        gradient.addColorStop(1, '#04050c');
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, width, height);

        // Stars, thinning toward the horizon where the glow drowns them.
        const random = seeded(20260910);
        for (let i = 0; i < 700; i += 1) {
          const x = random() * width;
          const v = random();
          const y = v * height * 0.52;
          const size = random() < 0.9 ? 1 : 2;
          ctx.fillStyle = '#ffffff';
          ctx.globalAlpha = (1 - v * 1.5) * (0.25 + random() * 0.6);
          ctx.fillRect(x, y, size, size);
        }
        ctx.globalAlpha = 1;

        // A few searchlight beams raking the sky above the venue.
        for (let i = 0; i < 5; i += 1) {
          const x = (i / 5) * width + random() * 80;
          const beam = ctx.createLinearGradient(x, height * 0.56, x + 60, height * 0.1);
          beam.addColorStop(0, 'rgba(255,220,150,0.14)');
          beam.addColorStop(1, 'rgba(255,220,150,0)');
          ctx.fillStyle = beam;
          ctx.beginPath();
          ctx.moveTo(x - 8, height * 0.56);
          ctx.lineTo(x + 8, height * 0.56);
          ctx.lineTo(x + 90, height * 0.08);
          ctx.lineTo(x + 40, height * 0.08);
          ctx.closePath();
          ctx.fill();
        }

        return canvas;
      },
      false,
    );

    texture.mapping = EquirectangularReflectionMapping;
    return texture;
  }

  dispose(): void {
    for (const texture of this.cache.values()) texture.dispose();
    this.cache.clear();
  }

  private cached(key: string, draw: () => HTMLCanvasElement, repeat = true): Texture {
    const existing = this.cache.get(key);
    if (existing) return existing;

    const texture = new CanvasTexture(draw());
    texture.colorSpace = SRGBColorSpace;
    if (repeat) {
      texture.wrapS = RepeatWrapping;
      texture.wrapT = RepeatWrapping;
    }
    texture.anisotropy = 4;
    texture.needsUpdate = true;
    this.cache.set(key, texture);
    return texture;
  }
}

const context = (size: number): CanvasRenderingContext2D => {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas context unavailable');
  return ctx;
};

const hex = (value: number): string => `#${value.toString(16).padStart(6, '0')}`;

/**
 * A tiny deterministic PRNG.
 *
 * Every client must draw the same sky. `Math.random` would give each player
 * their own star field, which is invisible until two people compare
 * screenshots and then looks like a bug in something far more important.
 */
const seeded = (seed: number): (() => number) => {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
};
