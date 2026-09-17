import { PLAYER_HEIGHT } from '@moonwalk/shared';
import {
  CanvasTexture,
  LinearFilter,
  SRGBColorSpace,
  Sprite,
  SpriteMaterial,
  type Object3D,
} from 'three';

/** How far above the character's feet the plate floats, in world units. */
const HEIGHT = PLAYER_HEIGHT + 1.15;

/** World width of a plate at one character of text, and its height. */
const SIZE = { perCharacter: 0.42, minWidth: 2.4, height: 0.9 } as const;

/** Canvas pixels per world unit. Readable from across the arena. */
const PIXELS_PER_UNIT = 64;

const FONT = '"Arial Black", "Segoe UI", system-ui, sans-serif';

/**
 * The player's name, floating over their character.
 *
 * It shows their BLOXITY DISPLAY NAME - the name they chose on bloxity.io,
 * spelled the way they chose it. Not a handle derived from an id, not a
 * session id, and nothing with an `@` or a tag on it: the only identity this
 * game has is Bloxity's, and the internal ids it keeps for persistence and
 * networking are never drawn.
 *
 * A SPRITE, so it faces the camera from every angle without anything having to
 * turn it each frame - and parented to the character's `root` rather than to
 * anything below it, so the death tip-over, the moonwalk half-turn and the
 * height proportion all leave it upright, unmirrored and the same size.
 */
export class NamePlate {
  private readonly canvas: HTMLCanvasElement;
  private readonly texture: CanvasTexture;
  private readonly material: SpriteMaterial;
  private readonly sprite: Sprite;

  /** What is currently drawn, so an unchanged name is not re-uploaded. */
  private drawn = '';

  constructor(parent: Object3D) {
    this.canvas = document.createElement('canvas');
    this.texture = new CanvasTexture(this.canvas);
    this.texture.colorSpace = SRGBColorSpace;
    this.texture.generateMipmaps = false;
    this.texture.minFilter = LinearFilter;

    this.material = new SpriteMaterial({
      map: this.texture,
      transparent: true,
      // Drawn over the world rather than into it: a name that disappeared
      // behind the arch or a treadmill would be missing exactly when a player
      // is looking for who is over there.
      depthTest: false,
      depthWrite: false,
    });
    this.sprite = new Sprite(this.material);
    this.sprite.position.y = HEIGHT;
    this.sprite.renderOrder = 10;
    this.sprite.visible = false;
    this.sprite.frustumCulled = false;
    parent.add(this.sprite);
  }

  /**
   * Show this name, or nothing at all for an empty one.
   *
   * Empty means the server has not verified a Bloxity account for that player -
   * a blank plate is the honest answer there, and better than a placeholder
   * that would read as somebody's name.
   */
  setName(name: string): void {
    const text = name.trim();
    if (text === this.drawn) return;
    this.drawn = text;
    this.sprite.visible = text.length > 0;
    if (!text) return;
    this.draw(text);
  }

  dispose(): void {
    this.sprite.removeFromParent();
    this.material.dispose();
    this.texture.dispose();
  }

  private draw(text: string): void {
    const width = Math.max(SIZE.minWidth, text.length * SIZE.perCharacter);
    this.canvas.width = Math.round(width * PIXELS_PER_UNIT);
    this.canvas.height = Math.round(SIZE.height * PIXELS_PER_UNIT);

    const ctx = this.canvas.getContext('2d');
    if (!ctx) return;
    const w = this.canvas.width;
    const h = this.canvas.height;
    ctx.clearRect(0, 0, w, h);

    // A dark lozenge behind the text: the arena is a night scene with neon in
    // it, and white text alone vanishes against a spotlight.
    const radius = h * 0.34;
    ctx.fillStyle = 'rgba(8, 6, 18, 0.62)';
    ctx.beginPath();
    ctx.moveTo(radius, h * 0.12);
    ctx.lineTo(w - radius, h * 0.12);
    ctx.quadraticCurveTo(w, h * 0.12, w, h * 0.12 + radius);
    ctx.lineTo(w, h * 0.88 - radius);
    ctx.quadraticCurveTo(w, h * 0.88, w - radius, h * 0.88);
    ctx.lineTo(radius, h * 0.88);
    ctx.quadraticCurveTo(0, h * 0.88, 0, h * 0.88 - radius);
    ctx.lineTo(0, h * 0.12 + radius);
    ctx.quadraticCurveTo(0, h * 0.12, radius, h * 0.12);
    ctx.fill();

    // Sized to FIT, the same rule every other piece of text in this world
    // follows: a name is the one string whose length is not ours to choose.
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    let size = h * 0.5;
    for (let pass = 0; pass < 4; pass += 1) {
      ctx.font = `900 ${size}px ${FONT}`;
      const drawn = ctx.measureText(text).width + size * 0.3;
      if (drawn <= w * 0.92) break;
      size *= (w * 0.92) / drawn;
    }
    ctx.font = `900 ${size}px ${FONT}`;
    ctx.lineWidth = size * 0.2;
    ctx.strokeStyle = 'rgba(8, 6, 18, 0.95)';
    ctx.strokeText(text, w / 2, h / 2);
    ctx.fillStyle = '#ffffff';
    ctx.fillText(text, w / 2, h / 2);

    this.texture.needsUpdate = true;
    this.sprite.scale.set(width, SIZE.height, 1);
  }
}
