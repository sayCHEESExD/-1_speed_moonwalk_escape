import {
  COURSE,
  TRAINING,
  TREADMILL_BELT_Y,
  TREADMILL_MULTIPLIER,
  TREADMILL_TIERS,
  treadmillZ,
} from '@moonwalk/shared';
import {
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  PlaneGeometry,
  type BufferGeometry,
  type Texture,
} from 'three';
import { PALETTE } from '../config/worldVisuals.js';
import { CanvasSign } from './CanvasSign.js';
import { texturedBox } from './texturedBox.js';

/** How fast the belt texture scrolls, in texture repeats per second. */
const BELT_SCROLL = 0.9;

/**
 * The training deck on the player's LEFT.
 *
 * Three treadmills, in TIERS. Unlike the previous game's three identical
 * belts, these are a small ladder - Rehearsal, Showtime, Headliner - because a
 * row of three identical machines gives a player no reason to ever look at the
 * second one, and because the reference art's training bay visibly escalates.
 * All three are usable from the first second: a machine that is standing in
 * the arena doing nothing until some far-off rebirth is scenery, not content.
 *
 * ORIENTATION is the thing to get right. A treadmill faces the way its runner
 * does, and the runner is meant to be looking back at the red carpet in the
 * middle of the arena - which from this deck on the +X wall is -X. So the belt
 * runs along X with the console at its -X end, and the three machines stand in
 * a row along Z. Building the belt along Z instead makes the bay read as a row
 * of beds.
 *
 * The belts themselves are real solids in the shared course data; everything
 * here is the machine around them. Gliding on starts the farming and gliding
 * off stops it, and that decision belongs entirely to the simulation.
 */
export class TrainingArea {
  readonly root = new Group();

  private readonly belts: Mesh[] = [];
  private readonly signs: CanvasSign[] = [];
  private readonly geometries: BufferGeometry[] = [];
  private readonly materials: MeshLambertMaterial[] = [];
  private readonly glows: Mesh[] = [];

  private time = 0;

  constructor(beltTexture: Texture) {
    const frame = this.material(PALETTE.treadmillFrame);
    const frameDark = this.material(PALETTE.treadmillFrameDark);
    const screen = this.material(PALETTE.treadmillScreen);

    /*
     * The belt material.
     *
     * WHITE, not the belt colour: a lit material MULTIPLIES its colour by its
     * map, so tinting an already-dark texture by its own dark colour crushes
     * the chevrons to black. The colours live in the texture; the material
     * just carries it, with enough emissive that the chevrons stay legible in
     * a night scene where the deck is in its own shadow.
     */
    const beltMaterial = this.material(0xffffff);
    beltMaterial.map = beltTexture;
    beltMaterial.emissive.setHex(0xffffff);
    beltMaterial.emissiveIntensity = 0.5;
    beltMaterial.emissiveMap = beltTexture;

    // Shared geometry: three machines are three transforms of the same nine
    // boxes, not three sets of geometry.
    const L = TRAINING.beltLength;
    const W = TRAINING.beltWidth;

    const deck = this.geometry(L + 1.6, 1.1, W + 1.4);
    const belt = this.geometry(L - 1.6, 0.3, W - 2.6);
    const rail = this.geometry(L + 1.6, 0.9, 1.2);
    const cowl = this.geometry(1.6, 1.3, W + 1.4);
    const post = this.geometry(1.0, 3.8, 1.0);
    const panel = this.geometry(1.2, 2.6, W - 1.4);
    const face = this.geometry(0.4, 1.5, W - 3.4);
    const handle = this.geometry(4.0, 0.8, 0.8);
    const strip = new PlaneGeometry(L + 1.6, 0.5);
    this.geometries.push(strip);

    for (const tier of TREADMILL_TIERS) {
      const machine = new Group();
      // No rotation: the belt geometry is authored running along X, which is
      // already the direction the runner faces.
      machine.position.set(TRAINING.centerX, TREADMILL_BELT_Y, treadmillZ(tier.index));

      machine.add(this.mesh(deck, frame, 0, -0.7, 0));

      const surface = this.mesh(belt, beltMaterial, 0, -0.05, 0);
      machine.add(surface);
      this.belts.push(surface);

      // Raised side edges either side of the belt.
      for (const side of [-1, 1]) {
        machine.add(this.mesh(rail, frameDark, 0, 0.25, side * (W / 2 - 0.1)));
      }

      // The roller cowl at the BACK - the end the runner steps on from, which
      // is +X, away from the carpet.
      machine.add(this.mesh(cowl, frameDark, L / 2 + 0.3, 0.05, 0));

      // The console at the FRONT: two uprights, a panel, a dark screen and the
      // two handles that reach back toward the runner.
      for (const side of [-1, 1]) {
        machine.add(this.mesh(post, frame, -(L / 2 - 0.5), 1.7, side * (W / 2 - 1.1)));
        machine.add(this.mesh(handle, frameDark, -(L / 2 - 2.6), 3.2, side * (W / 2 - 1.1)));
      }
      machine.add(this.mesh(panel, frame, -(L / 2 + 0.2), 3.7, 0));
      machine.add(this.mesh(face, screen, -(L / 2 + 0.75), 3.8, 0));

      /*
       * The tier's neon: two strips along the deck edges.
       *
       * This is how the three machines are told apart at a glance from across
       * a dark arena. The name on the sign is the confirmation; the COLOUR is
       * what the player actually navigates by.
       */
      for (const side of [-1, 1]) {
        const glowMaterial = new MeshBasicMaterial({
          color: tier.glow,
          transparent: true,
          opacity: 0.75,
          side: DoubleSide,
          depthWrite: false,
        });
        const glow = new Mesh(strip, glowMaterial);
        glow.rotation.x = -Math.PI / 2;
        glow.position.set(0, 0.72, side * (W / 2 + 0.5));
        machine.add(glow);
        this.glows.push(glow);
      }

      // The label, over the console and facing the carpet.
      const sign = new CanvasSign(11, 4.4, [
        {
          text: tier.name.toUpperCase(),
          size: 0.5,
          fill: '#ffffff',
          stroke: '#0a0f1a',
          strokeWidth: 0.16,
        },
        {
          // The SAME figure on every machine, read from the one constant, so
          // three signs cannot advertise three different deals.
          text: `x${TREADMILL_MULTIPLIER} SPEED`,
          size: 1,
          fill: '#ffe14d',
          stroke: '#2a2006',
          strokeWidth: 0.17,
        },
      ]);
      sign.mesh.position.set(-(L / 2 + 1), 6.6, 0);
      // Facing -X, back toward the carpet the player arrives from.
      sign.mesh.rotation.y = -Math.PI / 2;
      machine.add(sign.mesh);
      this.signs.push(sign);

      this.root.add(machine);
    }

    // The bay's own title, on the wall behind the machines.
    const title = new CanvasSign(40, 9, [
      { text: 'REHEARSAL', size: 1, fill: '#ffffff', stroke: '#2dd4ff', strokeWidth: 0.2 },
    ]);
    title.mesh.position.set(
      TRAINING.maxX + 0.5,
      COURSE.floorY + 17,
      (TRAINING.minZ + TRAINING.maxZ) / 2,
    );
    title.mesh.rotation.y = -Math.PI / 2;
    this.root.add(title.mesh);
    this.signs.push(title);
  }

  /** Scroll the belts, so a machine standing empty still looks like it runs. */
  update(delta: number): void {
    this.time += delta;
    for (const belt of this.belts) {
      const material = belt.material as MeshLambertMaterial;
      if (!material.map) continue;
      // Along U, which is the belt's own length - the surface travels BACKWARD
      // under a runner who is facing -X.
      material.map.offset.x = (-this.time * BELT_SCROLL) % 1;
    }
  }

  private mesh(
    geometry: BufferGeometry,
    material: MeshLambertMaterial,
    x: number,
    y: number,
    z: number,
  ): Mesh {
    const node = new Mesh(geometry, material);
    node.position.set(x, y, z);
    node.castShadow = true;
    node.receiveShadow = true;
    return node;
  }

  private geometry(w: number, h: number, d: number): BufferGeometry {
    const geometry = texturedBox(w, h, d, 3);
    this.geometries.push(geometry);
    return geometry;
  }

  private material(color: number): MeshLambertMaterial {
    const material = new MeshLambertMaterial({ color });
    this.materials.push(material);
    return material;
  }

  dispose(): void {
    for (const geometry of this.geometries) geometry.dispose();
    for (const material of this.materials) material.dispose();
    for (const glow of this.glows) (glow.material as MeshBasicMaterial).dispose();
    for (const sign of this.signs) sign.dispose();
    this.geometries.length = 0;
    this.materials.length = 0;
    this.glows.length = 0;
    this.signs.length = 0;
    this.root.removeFromParent();
  }
}
