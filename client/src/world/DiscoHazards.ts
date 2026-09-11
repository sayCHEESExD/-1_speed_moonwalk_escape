import {
  COURSE,
  COURSE_HAZARDS,
  hazardPositionAt,
  type CourseHazard,
} from '@moonwalk/shared';
import {
  CircleGeometry,
  CylinderGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  SphereGeometry,
  type BufferGeometry,
  type Material,
  type Texture,
} from 'three';
import { PALETTE } from '../config/worldVisuals.js';

/** How high the warning patch floats above the floor, to beat z-fighting. */
const WARN_LIFT = 0.06;

/** Radians per second a ball spins on its own axis. */
const SPIN_RATE = 2.4;

/**
 * Every disco ball in the world - and every one of them kills.
 *
 * There is exactly ONE hazard shape in this game, deliberately. A colour is a
 * promise and a silhouette is a promise, and in this world a mirror ball
 * promises "this will end your run" - whether it is rolling down the carpet,
 * swinging over it, orbiting a hub or dropping out of the rig. Four motions,
 * one object, one thing to learn.
 *
 * Every position here is a PURE FUNCTION of the server's clock: the server
 * evaluates `hazardPositionAt` against its own elapsed time to decide a death,
 * and this evaluates the identical function against the replicated value to
 * draw the ball. The two cannot disagree, because there is nothing to disagree
 * about - no hazard state is on the wire at all.
 */
export class DiscoHazards {
  readonly root = new Group();

  private readonly meshes: Mesh[] = [];
  /** The lit patch under each faller, or null for balls that do not fall. */
  private readonly warnings: (Mesh | null)[] = [];
  /** The cable a swinging or hanging ball hangs from, or null. */
  private readonly cables: (Mesh | null)[] = [];

  private readonly geometries: BufferGeometry[] = [];
  private readonly materials: Material[] = [];

  /** Scratch for a hazard position, so a frame allocates nothing. */
  private readonly at = { x: 0, y: 0, z: 0 };

  constructor(facets: Texture) {
    // 16x12 segments: chunky enough to read as a mirror ball, cheap enough
    // that thirty of them cost nothing.
    const ball = this.keep(new SphereGeometry(1, 16, 12));
    const patch = this.keep(new CircleGeometry(1, 18));
    const cable = this.keep(new CylinderGeometry(0.08, 0.08, 1, 6));

    /*
     * The ball material.
     *
     * WHITE with the facet map, plus a strong emissive of the same map. A lit
     * material MULTIPLIES its colour by its texture, and this world has almost
     * no ambient light - so a ball tinted its own dark base colour would be a
     * black sphere in a black city, which is a hazard nobody can see and
     * therefore not a hazard, just a death.
     */
    const ballMaterial = this.keepMaterial(new MeshLambertMaterial({ map: facets }));
    ballMaterial.emissive.setHex(PALETTE.discoBall);
    ballMaterial.emissiveIntensity = 0.5;
    ballMaterial.emissiveMap = facets;

    const cableMaterial = this.keepMaterial(
      new MeshLambertMaterial({ color: PALETTE.chromeDark }),
    );

    // Unlit and translucent: the warning is a marker on the floor, and a
    // marker that dimmed with the lighting would be least visible in the shade
    // of the thing about to land on it.
    const warnMaterial = this.keepMaterial(
      new MeshBasicMaterial({
        color: PALETTE.impactWarn,
        transparent: true,
        opacity: 0.42,
        depthWrite: false,
      }),
    );

    for (const hazard of COURSE_HAZARDS) {
      const mesh = new Mesh(ball, ballMaterial);
      mesh.scale.setScalar(hazard.radius);
      mesh.position.set(hazard.x, hazard.y, hazard.z);
      mesh.castShadow = true;
      this.root.add(mesh);
      this.meshes.push(mesh);

      this.warnings.push(
        hazard.kind === 'faller' ? this.addWarning(patch, warnMaterial, hazard) : null,
      );
      // A sweeper and a faller both hang from the rig, so both get a cable.
      // Without one they are balls floating in the air with no reason to.
      this.cables.push(
        hazard.kind === 'sweeper' || hazard.kind === 'faller'
          ? this.addCable(cable, cableMaterial)
          : null,
      );
    }
  }

  /** @param elapsed the server's clock, in seconds. */
  update(elapsed: number): void {
    for (let i = 0; i < this.meshes.length; i += 1) {
      const hazard = COURSE_HAZARDS[i];
      const mesh = this.meshes[i];
      if (!hazard || !mesh) continue;

      hazardPositionAt(hazard, elapsed, this.at);
      mesh.position.set(this.at.x, this.at.y, this.at.z);

      // Every ball spins on its own axis. It is the one thing that separates a
      // mirror ball from a grey sphere, and it costs one assignment.
      mesh.rotation.y = elapsed * SPIN_RATE + hazard.phase;

      if (hazard.kind === 'roller') {
        // Rolling the RIGHT way: the spin comes from the same travel the
        // position does, so a ball never slides while appearing to roll
        // backwards.
        mesh.rotation.x = -this.at.z / hazard.radius;
      }

      const cable = this.cables[i];
      if (cable) {
        // The cable runs from the rig height down to the top of the ball, so
        // it stretches as a faller drops rather than sliding along with it.
        const top = COURSE.floorY + RIG_HEIGHT;
        const length = Math.max(0.1, top - this.at.y);
        cable.position.set(this.at.x, this.at.y + length / 2, this.at.z);
        cable.scale.y = length;
      }

      if (hazard.kind !== 'faller') continue;
      const warning = this.warnings[i];
      if (!warning) continue;
      // The patch tightens and brightens as the ball comes down, so a glance
      // says how long is left rather than merely that something is overhead.
      // Both come from the SAME height the kill does.
      const fallen = 1 - (this.at.y - hazard.y) / Math.max(1, hazard.sweep);
      warning.scale.setScalar(hazard.radius * (1.9 - fallen * 0.6));
      (warning.material as MeshBasicMaterial).opacity = 0.2 + fallen * 0.45;
    }
  }

  dispose(): void {
    for (const geometry of this.geometries) geometry.dispose();
    for (const material of this.materials) material.dispose();
    this.geometries.length = 0;
    this.materials.length = 0;
    this.root.removeFromParent();
  }

  private addWarning(
    geometry: BufferGeometry,
    material: Material,
    hazard: CourseHazard,
  ): Mesh {
    // Cloned so each patch can carry its own opacity as its ball falls.
    const mesh = new Mesh(geometry, material.clone());
    this.materials.push(mesh.material as Material);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(hazard.x, COURSE.floorY + WARN_LIFT, hazard.z);
    mesh.scale.setScalar(hazard.radius * 1.9);
    this.root.add(mesh);
    return mesh;
  }

  private addCable(geometry: BufferGeometry, material: Material): Mesh {
    const mesh = new Mesh(geometry, material);
    this.root.add(mesh);
    return mesh;
  }

  private keep<T extends BufferGeometry>(geometry: T): T {
    this.geometries.push(geometry);
    return geometry;
  }

  private keepMaterial<T extends Material>(material: T): T {
    this.materials.push(material);
    return material;
  }
}

/**
 * Height of the lighting rig every hanging ball is slung from.
 *
 * Presentation only - nothing collides with the rig - but it has to be the one
 * number the trusses are drawn at too, or the cables would hang from thin air
 * a few units under the beams.
 */
export const RIG_HEIGHT = 24;
