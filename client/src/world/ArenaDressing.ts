import {
  ARENA_CARPET,
  COURSE,
  DECORATIONS,
  VIP_ARCH,
  type Decoration,
} from '@moonwalk/shared';
import {
  AdditiveBlending,
  CylinderGeometry,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  PlaneGeometry,
  SphereGeometry,
  type BufferGeometry,
  type Material,
  type Texture,
} from 'three';
import { PALETTE } from '../config/worldVisuals.js';
import { CanvasSign } from './CanvasSign.js';
import { RIG_HEIGHT } from './DiscoHazards.js';
import { texturedBox } from './texturedBox.js';

/** How fast a hanging decorative ball turns, in radians per second. */
const BALL_SPIN = 0.7;

/** How fast the spotlight cones sweep, in cycles per second. */
const SWEEP_RATE = 0.11;

/**
 * Everything in the arena that is not a floor, a treadmill or a tile.
 *
 * The VIP arch, the velvet ropes, the ground spotlights, the hanging mirror
 * balls and the overhead trusses. All of it is scenery the simulation knows
 * nothing about, with one exception: the arch's two uprights ARE real solids in
 * the shared course data, because they stand where a player could walk into
 * them. This file draws them; it does not decide where they are.
 *
 * Everything merges into a handful of meshes. A red-carpet event's worth of
 * dressing is about a dozen draw calls, not four hundred.
 */
export class ArenaDressing {
  readonly root = new Group();

  private readonly geometries: BufferGeometry[] = [];
  private readonly materials: Material[] = [];
  private readonly signs: CanvasSign[] = [];

  /** Hanging mirror balls, spun every frame. */
  private readonly balls: Mesh[] = [];
  /** Spotlight cones, swept every frame. */
  private readonly cones: Mesh[] = [];

  private time = 0;

  constructor(facets: Texture) {
    this.buildArch();
    this.buildDecorations(facets);
  }

  update(delta: number): void {
    this.time += delta;

    for (const ball of this.balls) ball.rotation.y = this.time * BALL_SPIN;

    // The cones rake back and forth, out of phase with each other. It is the
    // single cheapest thing that makes a static scene feel like a live event.
    for (let i = 0; i < this.cones.length; i += 1) {
      const cone = this.cones[i];
      if (!cone) continue;
      const phase = this.time * Math.PI * 2 * SWEEP_RATE + i * 1.7;
      cone.rotation.z = Math.sin(phase) * 0.28;
      cone.rotation.x = Math.cos(phase * 0.7) * 0.16;
    }
  }

  dispose(): void {
    for (const geometry of this.geometries) geometry.dispose();
    for (const material of this.materials) material.dispose();
    for (const sign of this.signs) sign.dispose();
    this.geometries.length = 0;
    this.materials.length = 0;
    this.signs.length = 0;
    this.root.removeFromParent();
  }

  /**
   * The VIP entrance the carpet runs out through.
   *
   * The two uprights are drawn where the shared config already put their
   * colliders; the lintel above is scenery only. A solid slab overhead would
   * be a ceiling to head-butt at exactly the moment a player is building speed
   * into the first stage, which is the worst possible place for one.
   */
  private buildArch(): void {
    const chrome = this.material(PALETTE.chrome);
    const gold = this.emissive(PALETTE.neonGold, 0.85);

    const postGeometry = this.keep(
      texturedBox(VIP_ARCH.postWidth, VIP_ARCH.height, VIP_ARCH.postDepth, 4),
    );
    for (const side of [-1, 1]) {
      const post = new Mesh(postGeometry, chrome);
      post.position.set(
        side * (VIP_ARCH.halfWidth + VIP_ARCH.postWidth / 2),
        COURSE.floorY + VIP_ARCH.height / 2,
        VIP_ARCH.z,
      );
      post.castShadow = true;
      this.root.add(post);

      // A vertical run of bulbs up each post.
      const bulbs = this.keep(new PlaneGeometry(0.7, VIP_ARCH.height * 0.9));
      const strip = new Mesh(bulbs, gold);
      strip.position.set(
        side * (VIP_ARCH.halfWidth + VIP_ARCH.postWidth / 2),
        COURSE.floorY + VIP_ARCH.height / 2,
        VIP_ARCH.z - VIP_ARCH.postDepth / 2 - 0.05,
      );
      this.root.add(strip);
    }

    // The lintel.
    const width = (VIP_ARCH.halfWidth + VIP_ARCH.postWidth) * 2;
    const lintelGeometry = this.keep(
      texturedBox(width, VIP_ARCH.lintelHeight, VIP_ARCH.postDepth, 4),
    );
    const lintel = new Mesh(lintelGeometry, chrome);
    lintel.position.set(
      0,
      COURSE.floorY + VIP_ARCH.height + VIP_ARCH.lintelHeight / 2,
      VIP_ARCH.z,
    );
    this.root.add(lintel);

    // The bulb run across the lintel, on both faces so it reads coming and
    // going - this is the one piece of arena dressing a returning player sees
    // from the far side.
    const bulbRow = this.keep(new PlaneGeometry(width * 0.94, 1.1));
    for (const face of [-1, 1]) {
      const bulbs = new Mesh(bulbRow, gold);
      bulbs.position.set(
        0,
        COURSE.floorY + VIP_ARCH.height + VIP_ARCH.lintelHeight / 2,
        VIP_ARCH.z + face * (VIP_ARCH.postDepth / 2 + 0.05),
      );
      if (face < 0) bulbs.rotation.y = Math.PI;
      this.root.add(bulbs);
    }

    // "VIP ENTRANCE", facing back into the arena.
    const sign = new CanvasSign(width * 0.8, 7, [
      { text: 'VIP', size: 0.5, fill: '#ffe14d', stroke: '#2a1a02', strokeWidth: 0.18 },
      { text: 'ENTRANCE', size: 0.8, fill: '#ffffff', stroke: '#2a1a02', strokeWidth: 0.18 },
    ]);
    sign.mesh.position.set(
      0,
      COURSE.floorY + VIP_ARCH.height + VIP_ARCH.lintelHeight / 2,
      VIP_ARCH.z - VIP_ARCH.postDepth / 2 - 0.2,
    );
    sign.mesh.rotation.y = Math.PI;
    this.root.add(sign.mesh);
    this.signs.push(sign);
  }

  /**
   * Everything the course data asked for: ropes, spotlights, trusses, balls.
   *
   * Driven from `DECORATIONS`, so a stage builder adding a truss gets one
   * drawn without this file learning anything about that stage.
   */
  private buildDecorations(facets: Texture): void {
    const brass = this.material(PALETTE.brass);
    const rope = this.material(PALETTE.rope);
    const chromeDark = this.material(PALETTE.chromeDark);

    const ballMaterial = this.keepMaterial(new MeshLambertMaterial({ map: facets }));
    ballMaterial.emissive.setHex(PALETTE.discoBall);
    ballMaterial.emissiveIntensity = 0.45;
    ballMaterial.emissiveMap = facets;

    const ballGeometry = this.keep(new SphereGeometry(1, 14, 10));
    const cableGeometry = this.keep(new CylinderGeometry(0.07, 0.07, 1, 6));
    const postGeometry = this.keep(new CylinderGeometry(0.22, 0.28, 3.2, 8));
    const baseGeometry = this.keep(new CylinderGeometry(0.6, 0.7, 0.3, 10));
    const ropeGeometry = this.keep(new CylinderGeometry(0.12, 0.12, 1, 6));
    const coneGeometry = this.keep(new CylinderGeometry(3.6, 0.5, 26, 10, 1, true));

    // Velvet ropes are drawn as a post plus a swag to the NEXT post along, so
    // the run is built pairwise from the ordered list rather than each post
    // standing alone.
    const barriers = DECORATIONS.filter((d) => d.kind === 'barrier');

    for (const decoration of DECORATIONS) {
      switch (decoration.kind) {
        case 'barrier':
          this.buildBarrier(decoration, barriers, postGeometry, baseGeometry, ropeGeometry, brass, rope);
          break;
        case 'ball':
          this.buildHangingBall(decoration, ballGeometry, ballMaterial, cableGeometry, chromeDark);
          break;
        case 'spotlight':
          this.buildSpotlight(decoration, baseGeometry, coneGeometry, chromeDark);
          break;
        case 'truss':
          this.buildTruss(decoration, chromeDark);
          break;
        case 'neonSign':
          this.buildNeonSign(decoration);
          break;
        default:
          break;
      }
    }
  }

  private buildBarrier(
    decoration: Decoration,
    all: readonly Decoration[],
    postGeometry: BufferGeometry,
    baseGeometry: BufferGeometry,
    ropeGeometry: BufferGeometry,
    brass: Material,
    rope: Material,
  ): void {
    const post = new Mesh(postGeometry, brass);
    post.position.set(decoration.x, decoration.y + 1.6, decoration.z);
    this.root.add(post);

    const base = new Mesh(baseGeometry, brass);
    base.position.set(decoration.x, decoration.y + 0.15, decoration.z);
    this.root.add(base);

    // The swag to the next post on the SAME side of the carpet. Matching on
    // the sign of X is what keeps a rope from being slung straight across the
    // runway between two posts that merely happen to be adjacent in the list.
    const next = all.find(
      (other) =>
        other !== decoration &&
        Math.sign(other.x) === Math.sign(decoration.x) &&
        Math.abs(other.x - decoration.x) < 0.5 &&
        other.z > decoration.z &&
        other.z - decoration.z < 12,
    );
    if (!next) return;

    const span = next.z - decoration.z;
    const cord = new Mesh(ropeGeometry, rope);
    cord.scale.y = span;
    cord.rotation.x = Math.PI / 2;
    // Dipped a little below the post tops, so it hangs rather than being taut.
    cord.position.set(decoration.x, decoration.y + 2.6, decoration.z + span / 2);
    this.root.add(cord);
  }

  private buildHangingBall(
    decoration: Decoration,
    ballGeometry: BufferGeometry,
    ballMaterial: Material,
    cableGeometry: BufferGeometry,
    cableMaterial: Material,
  ): void {
    const ball = new Mesh(ballGeometry, ballMaterial);
    ball.scale.setScalar(decoration.scale);
    ball.position.set(decoration.x, decoration.y, decoration.z);
    this.root.add(ball);
    this.balls.push(ball);

    // The cable up to the rig. A ball hanging from nothing is the one thing
    // that makes a night scene read as unfinished.
    const top = COURSE.floorY + RIG_HEIGHT + 6;
    const length = Math.max(0.2, top - decoration.y);
    const cable = new Mesh(cableGeometry, cableMaterial);
    cable.scale.y = length;
    cable.position.set(decoration.x, decoration.y + length / 2, decoration.z);
    this.root.add(cable);
  }

  private buildSpotlight(
    decoration: Decoration,
    baseGeometry: BufferGeometry,
    coneGeometry: BufferGeometry,
    housing: Material,
  ): void {
    const base = new Mesh(baseGeometry, housing);
    base.scale.setScalar(1.6);
    base.position.set(decoration.x, decoration.y + 0.3, decoration.z);
    this.root.add(base);

    /*
     * The beam.
     *
     * An open-ended cone with an ADDITIVE, unlit material and no depth write -
     * so it brightens whatever is behind it and never occludes anything. A
     * real spotlight would be a shadow-casting light per fixture, which is
     * dozens of lights in one scene and most of a phone's frame budget for an
     * effect a translucent cone conveys at a distance.
     */
    const material = this.keepMaterial(
      new MeshBasicMaterial({
        color: decoration.colour,
        transparent: true,
        opacity: 0.09,
        side: DoubleSide,
        depthWrite: false,
        blending: AdditiveBlending,
      }),
    );
    const cone = new Mesh(coneGeometry, material);
    // Cylinder geometry is built along Y with its middle at the origin, so it
    // is lifted by half its length to stand on the fixture.
    cone.position.set(decoration.x, decoration.y + 13, decoration.z);
    this.root.add(cone);
    this.cones.push(cone);
  }

  /** An overhead lighting truss: two chords and a run of diagonals. */
  private buildTruss(decoration: Decoration, material: Material): void {
    const span = COURSE.halfWidth * 2 + 8;
    const y = COURSE.floorY + RIG_HEIGHT + 4;

    const chord = this.keep(texturedBox(span, 0.7, 0.7, 4));
    for (const offset of [-1.4, 1.4]) {
      const bar = new Mesh(chord, material);
      bar.position.set(0, y + offset * 0.5, decoration.z + offset);
      this.root.add(bar);
    }

    const strut = this.keep(texturedBox(0.4, 2.6, 0.4, 4));
    const count = Math.floor(span / 6);
    for (let i = 0; i <= count; i += 1) {
      const bar = new Mesh(strut, material);
      bar.position.set(-span / 2 + (i / count) * span, y, decoration.z);
      bar.rotation.x = i % 2 === 0 ? 0.5 : -0.5;
      this.root.add(bar);
    }
  }

  /** A big glowing panel standing against a wall. */
  private buildNeonSign(decoration: Decoration): void {
    const geometry = this.keep(new PlaneGeometry(16 * decoration.scale, 9 * decoration.scale));
    const material = this.keepMaterial(
      new MeshBasicMaterial({
        color: decoration.colour,
        transparent: true,
        opacity: 0.55,
        side: DoubleSide,
        depthWrite: false,
      }),
    );
    const panel = new Mesh(geometry, material);
    panel.position.set(decoration.x, decoration.y, decoration.z);
    panel.rotation.y = decoration.rotationY;
    this.root.add(panel);
  }

  private keep<T extends BufferGeometry>(geometry: T): T {
    this.geometries.push(geometry);
    return geometry;
  }

  private keepMaterial<T extends Material>(material: T): T {
    this.materials.push(material);
    return material;
  }

  private material(colour: number | string): Material {
    return this.keepMaterial(new MeshLambertMaterial({ color: colour }));
  }

  private emissive(colour: number, intensity: number): Material {
    const material = new MeshBasicMaterial({
      color: colour,
      transparent: true,
      opacity: intensity,
      side: DoubleSide,
      depthWrite: false,
    });
    return this.keepMaterial(material);
  }
}

/** Re-exported so callers need one import for the arena's own metrics. */
export { ARENA_CARPET };
