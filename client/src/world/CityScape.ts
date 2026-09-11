import { COURSE, COURSE_END_Z, corridorHalfWidthAt } from '@moonwalk/shared';
import {
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  PlaneGeometry,
  type BufferGeometry,
  type Material,
  type Texture,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { PALETTE, SCENERY } from '../config/worldVisuals.js';
import { texturedBox } from './texturedBox.js';

/** World units one repeat of the facade texture covers. */
const FACADE_TILE = 9;

/**
 * The night city that lines the whole course.
 *
 * Modular and generated, not authored. A block is a box with a window facade
 * on it, and the whole skyline - three rows deep, both sides, two thousand
 * units long - is TWO merged meshes plus one for the neon. Adding a stage
 * extends the city for free.
 *
 * Variation is DETERMINISTIC, from a hash of the block's index. Never
 * `Math.random`: two players standing beside each other must be looking at the
 * same skyline, and a city that differed per client is the kind of bug nobody
 * notices until they compare screenshots.
 *
 * Nothing here collides. What holds the player in is
 * `WorldCollision.clampToBounds`, applied after the substep has integrated, so
 * no speed can tunnel it the way a building collider could be.
 */
export class CityScape {
  readonly root = new Group();

  private readonly geometries: BufferGeometry[] = [];
  private readonly materials: Material[] = [];

  constructor(facade: Texture) {
    const blocks: BufferGeometry[] = [];
    const roofs: BufferGeometry[] = [];
    const signs: { geometry: BufferGeometry; colour: number }[] = [];

    let index = 0;
    const from = COURSE.lobbyStartZ - 60;
    const to = COURSE_END_Z + 60;

    for (let z = from; z < to; z += SCENERY.blockSpacingZ) {
      for (const side of [-1, 1]) {
        for (let row = 0; row < SCENERY.rows; row += 1) {
          index += 1;
          const rand = hash(index);
          const rand2 = hash(index * 7919);

          const width = lerp(SCENERY.minWidth, SCENERY.maxWidth, rand);
          // Rows further back are taller, so the skyline builds up behind the
          // near facades instead of hiding them.
          const heightBias = row / Math.max(1, SCENERY.rows - 1);
          const height = lerp(
            SCENERY.minHeight,
            SCENERY.maxHeight,
            rand2 * 0.6 + heightBias * 0.4,
          );

          // The near facade stands just outside whatever the corridor is doing
          // here, so a wide arena pushes its own buildings back rather than
          // swallowing them.
          const halfWidth = corridorHalfWidthAt(z);
          const x =
            side *
            (halfWidth + SCENERY.offsetX + row * SCENERY.rowDepth + rand * 10);
          const at = z + rand2 * SCENERY.blockSpacingZ * 0.7;

          const block = texturedBox(width, height, width * 0.9, FACADE_TILE);
          block.translate(x, COURSE.floorY + height / 2 - COURSE.floorThickness, at);
          blocks.push(block);

          // A flat roof cap, slightly wider - the lip that stops a tower
          // reading as an extruded rectangle.
          const cap = texturedBox(width + 1.2, 1.4, width * 0.9 + 1.2, FACADE_TILE);
          cap.translate(x, COURSE.floorY + height - COURSE.floorThickness, at);
          roofs.push(cap);

          /*
           * A neon sign on the near row only.
           *
           * Only the first row is ever legible from the carpet, so signs on the
           * rows behind it would be light pollution costing draw calls. Roughly
           * one building in three gets one, which is enough to read as a
           * nightlife district and few enough to stay readable.
           */
          if (row === 0 && rand2 > 0.62) {
            const signHeight = 6 + rand * 8;
            const panel = new PlaneGeometry(width * 0.7, signHeight);
            panel.translate(
              x - side * (width / 2 + 0.4),
              COURSE.floorY + height * (0.35 + rand * 0.4),
              at,
            );
            panel.rotateY(side > 0 ? -Math.PI / 2 : Math.PI / 2);
            signs.push({ geometry: panel, colour: neonFor(index) });
          }
        }
      }
    }

    this.addMerged(
      blocks,
      this.keepMaterial(new MeshLambertMaterial({ map: facade })),
    );
    this.addMerged(
      roofs,
      this.keepMaterial(new MeshLambertMaterial({ color: PALETTE.buildingAlt })),
    );

    // Signs are grouped BY COLOUR, so five neon tints are five draw calls
    // rather than one per sign.
    const byColour = new Map<number, BufferGeometry[]>();
    for (const sign of signs) {
      const list = byColour.get(sign.colour);
      if (list) list.push(sign.geometry);
      else byColour.set(sign.colour, [sign.geometry]);
    }
    for (const [colour, parts] of byColour) {
      this.addMerged(
        parts,
        this.keepMaterial(
          new MeshBasicMaterial({
            color: colour,
            transparent: true,
            opacity: 0.62,
            side: DoubleSide,
            depthWrite: false,
          }),
        ),
      );
    }
  }

  dispose(): void {
    for (const geometry of this.geometries) geometry.dispose();
    for (const material of this.materials) material.dispose();
    this.geometries.length = 0;
    this.materials.length = 0;
    this.root.removeFromParent();
  }

  private addMerged(parts: BufferGeometry[], material: Material): void {
    if (parts.length === 0) return;
    const merged = mergeGeometries(parts, false);
    for (const part of parts) part.dispose();
    if (!merged) return;
    this.geometries.push(merged);
    const mesh = new Mesh(merged, material);
    // The city neither casts nor receives: it is a backdrop, and shadow-mapping
    // two thousand units of skyline to darken a wall nobody stands against is
    // the easiest frame budget in the game to give away.
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    this.root.add(mesh);
  }

  private keepMaterial<T extends Material>(material: T): T {
    this.materials.push(material);
    return material;
  }
}

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

/**
 * A stable 0..1 from an integer.
 *
 * The same mixing constant the previous games used for their treelines, for
 * the same reason: a hash is reproducible on every machine and `Math.random`
 * is not.
 */
const hash = (value: number): number => ((value * 2654435761) >>> 0) / 4294967296;

const NEON = [
  PALETTE.neonPink,
  PALETTE.neonCyan,
  PALETTE.neonGold,
  PALETTE.neonViolet,
  PALETTE.neonGreen,
] as const;

const neonFor = (index: number): number =>
  NEON[Math.floor(hash(index * 31) * NEON.length) % NEON.length] as number;
