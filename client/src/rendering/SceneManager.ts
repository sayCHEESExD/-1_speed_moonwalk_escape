import {
  AmbientLight,
  Color,
  DirectionalLight,
  Fog,
  HemisphereLight,
  PointLight,
  Scene,
  type Texture,
} from 'three';
import { PALETTE, WORLD_FOG } from '../config/worldVisuals.js';

/** Bounce colour off the red carpet - the ground light in this whole world. */
const CARPET_BOUNCE = 0x3a0c16;

/**
 * The scene root and the base lighting rig.
 *
 * PERMANENT NIGHT, and the rig is built for it rather than being a daytime rig
 * turned down. There is no sun. What lights the world is:
 *
 *   - a very low hemisphere fill, cold from above and carpet-red from below,
 *     so a box has a top and a bottom without anything being lit;
 *   - a dim ambient, purely so nothing is ever pure black;
 *   - a KEY light that follows the player, standing in for the bank of venue
 *     lighting the character is walking through. It is the only shadow-caster.
 *   - a warm point light at the player's own position, so they carry a pool of
 *     light with them down a dark carpet.
 *
 * Everything else that glows in this game glows because its material is
 * emissive - the neon, the disco balls, the dance floor, the signs. That is
 * deliberate: emissive costs nothing per light, and a scene with fifty real
 * lights in it is a scene that does not run on a phone.
 */
export class SceneManager {
  readonly scene = new Scene();

  /** The key light. Exposed so its shadow camera can follow the player. */
  readonly key: DirectionalLight;

  /** The warm pool the player carries. Follows them exactly. */
  private readonly followLight: PointLight;

  constructor() {
    this.scene.fog = new Fog(PALETTE.fog, WORLD_FOG.near, WORLD_FOG.far);
    this.scene.background = new Color(PALETTE.sky);

    // Cold from the sky, carpet-red from the ground. Low, because this is a
    // night scene and a strong fill is what makes one look like an overcast
    // afternoon instead.
    const hemi = new HemisphereLight(0x2a3a6a, CARPET_BOUNCE, 0.55);
    hemi.position.set(0, 60, 0);
    this.scene.add(hemi);

    this.scene.add(new AmbientLight(0x8899cc, 0.22));

    this.key = new DirectionalLight(0xbcd0ff, 1.05);
    this.key.position.set(26, 54, -20);
    this.key.castShadow = true;
    this.key.shadow.mapSize.set(1024, 1024);
    this.key.shadow.camera.near = 1;
    this.key.shadow.camera.far = 200;
    this.key.shadow.camera.left = -55;
    this.key.shadow.camera.right = 55;
    this.key.shadow.camera.top = 55;
    this.key.shadow.camera.bottom = -55;
    this.key.shadow.bias = -0.0009;
    this.scene.add(this.key);
    this.scene.add(this.key.target);

    /*
     * The pool the player carries.
     *
     * One point light, no shadow. Without it the character is a silhouette on
     * a dark carpet for the whole game - and this is a game about watching a
     * character dance, so the one thing that must always be lit is them.
     */
    this.followLight = new PointLight(0xffd9a8, 26, 34, 2);
    this.scene.add(this.followLight);
  }

  /**
   * The night sky, as the scene background.
   *
   * Set after construction because the texture is drawn by `WorldTextures`,
   * which the world owns. Until it arrives the flat sky colour stands in, and
   * the two are matched so the swap is invisible.
   */
  setSky(texture: Texture): void {
    this.scene.background = texture;
  }

  /**
   * Keep the shadow frustum and the carried light over the player.
   *
   * The course is two thousand units long and the shadow map is one texture. A
   * frustum big enough to cover the whole run would put a handful of texels
   * under each character; moving a small frustum with the player keeps the
   * shadows crisp everywhere and costs one vector copy a frame.
   */
  followShadow(x: number, y: number, z: number): void {
    this.key.target.position.set(x, y, z);
    this.key.position.set(x + 26, y + 54, z - 20);
    this.key.target.updateMatrixWorld();
    // Lifted to chest height, so it lights the character rather than washing
    // out the carpet under their feet.
    this.followLight.position.set(x, y + 3.4, z);
  }
}
