import {
  COURSE,
  COURSE_END_Z,
  COURSE_SOLIDS,
  STAGES,
  TRAINING,
  WIDE_AREAS,
  WorldCollision,
  corridorHalfWidthAt,
  type CourseSolid,
  type SolidKind,
} from '@moonwalk/shared';
import {
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  PlaneGeometry,
  Scene,
  type BufferGeometry,
  type Material,
  type Texture,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { PALETTE } from '../config/worldVisuals.js';
import { ArenaDressing } from './ArenaDressing.js';
import { CityScape } from './CityScape.js';
import { DiscoHazards } from './DiscoHazards.js';
import { FinishBanners } from './FinishBanners.js';
import { Scoreboard } from './Scoreboard.js';
import { StageSigns } from './StageSigns.js';
import { TrainingArea } from './TrainingArea.js';
import { UpgradeTiles } from './UpgradeTiles.js';
import { WorldTextures } from './WorldTextures.js';
import { texturedBox } from './texturedBox.js';

/** World units one repeat of a tiling texture covers. */
const TILE = 6;

/**
 * The visible world.
 *
 * Every solid it draws comes from `COURSE_SOLIDS` - the SAME array the
 * collision model is built from - so a platform the player can see but not
 * stand on is structurally impossible. `CourseWorld` is the visuals and
 * `WorldCollision` is the gameplay shape, and they cannot drift apart because
 * neither owns a coordinate.
 *
 * Geometry is merged per material, so a two-thousand-unit course with ten
 * stages and a city down both sides is a couple of dozen draw calls rather
 * than a few hundred meshes.
 */
export class CourseWorld {
  readonly root = new Group();

  /** The gameplay shape of the same data. Shared with the local prediction. */
  readonly collision = new WorldCollision();

  readonly hazards: DiscoHazards;
  readonly tiles: UpgradeTiles;
  readonly banners: FinishBanners;
  readonly signs: StageSigns;
  readonly training: TrainingArea;
  readonly dressing: ArenaDressing;
  readonly city: CityScape;
  /** The three leaderboards on the arena's back wall. */
  readonly scoreboard: Scoreboard;

  private readonly textures = new WorldTextures();
  private readonly materials: Material[] = [];
  private readonly geometries: BufferGeometry[] = [];

  constructor() {
    this.buildSolids();
    this.buildPitFloor();
    this.buildWalls();

    const facets = this.textures.discoFacets(PALETTE.discoBall, PALETTE.discoFacet);

    this.hazards = new DiscoHazards(facets);
    this.root.add(this.hazards.root);

    this.tiles = new UpgradeTiles();
    this.root.add(this.tiles.root);

    this.banners = new FinishBanners();
    this.root.add(this.banners.root);

    this.signs = new StageSigns();
    this.root.add(this.signs.root);

    this.training = new TrainingArea(this.textures.belt(PALETTE.belt, PALETTE.beltMark));
    this.root.add(this.training.root);

    this.dressing = new ArenaDressing(facets);
    this.root.add(this.dressing.root);

    this.city = new CityScape(
      this.textures.facade(PALETTE.building, PALETTE.window, PALETTE.windowCool),
    );
    this.root.add(this.city.root);

    this.scoreboard = new Scoreboard();
    this.root.add(this.scoreboard.root);
  }

  /** The night sky, for the scene background. */
  get skyTexture(): Texture {
    return this.textures.nightSky();
  }

  addTo(scene: Scene): void {
    scene.add(this.root);
  }

  /**
   * @param elapsed the server's clock, replicated. Every disco ball is a pure
   *                function of it, so drawing them from it is what makes what
   *                is on screen the same thing the server will kill with.
   */
  update(delta: number, elapsed: number): void {
    this.hazards.update(elapsed);
    this.tiles.update(delta);
    this.banners.update(delta);
    this.training.update(delta);
    this.dressing.update(delta);
  }

  dispose(): void {
    this.textures.dispose();
    for (const material of this.materials) material.dispose();
    for (const geometry of this.geometries) geometry.dispose();
    this.hazards.dispose();
    this.tiles.dispose();
    this.banners.dispose();
    this.signs.dispose();
    this.training.dispose();
    this.dressing.dispose();
    this.city.dispose();
    this.scoreboard.dispose();
    this.root.removeFromParent();
  }

  /** Draw every solid, grouped by kind so each group is one mesh. */
  private buildSolids(): void {
    const byKind = new Map<SolidKind, BufferGeometry[]>();

    for (const solid of COURSE_SOLIDS) {
      const list = byKind.get(solid.kind) ?? [];
      list.push(boxFor(solid, TILE));
      byKind.set(solid.kind, list);
    }

    for (const [kind, geometries] of byKind) {
      const merged = mergeGeometries(geometries, false);
      for (const geometry of geometries) geometry.dispose();
      if (!merged) continue;
      this.geometries.push(merged);

      const mesh = new Mesh(merged, this.materialFor(kind));
      mesh.receiveShadow = true;
      mesh.castShadow =
        kind === 'riser' || kind === 'pillar' || kind === 'plank' || kind === 'stage';
      this.root.add(mesh);
    }
  }

  /**
   * The bottom of the world: a lit service level.
   *
   * One slab under everything. Without it a fall shows the underside of the
   * course and an infinite void, which is exactly what makes a map look
   * unfinished - and it is not a cover-up, because the death plane sits well
   * ABOVE it: the player dies looking at a floor they were falling toward,
   * rather than into nothing.
   */
  private buildPitFloor(): void {
    const widest = Math.max(
      COURSE.lobbyHalfWidth,
      ...WIDE_AREAS.map((area) => area.halfWidth),
    );
    const width = widest * 2 + 140;
    const from = COURSE.lobbyStartZ - 60;
    const to = COURSE_END_Z + 60;

    const floor = texturedBox(width, 6, to - from, TILE * 2);
    floor.translate(0, COURSE.pitFloorY - 3, (from + to) / 2);
    this.geometries.push(floor);
    const mesh = new Mesh(floor, this.solidMaterial(PALETTE.pitFloor));
    mesh.receiveShadow = true;
    this.root.add(mesh);
  }

  /**
   * The walls that box the world in, capped with a neon strip.
   *
   * These are SCENERY. What actually holds the player in is
   * `WorldCollision.clampToBounds`, which is applied after the substep has
   * already integrated and therefore cannot be tunnelled at any speed.
   */
  private buildWalls(): void {
    const thickness = 5;
    const walls: BufferGeometry[] = [];
    const strips: BufferGeometry[] = [];

    const run = (halfWidth: number, fromZ: number, toZ: number): void => {
      const length = toZ - fromZ;
      if (length <= 0) return;
      const centreZ = (fromZ + toZ) / 2;

      for (const side of [-1, 1]) {
        const x = side * (halfWidth + thickness / 2);
        const wall = texturedBox(thickness, COURSE.wallHeight, length, TILE);
        wall.translate(x, COURSE.wallHeight / 2 - COURSE.floorThickness, centreZ);
        walls.push(wall);

        // The neon capping strip, on the INNER face - the only one anybody
        // sees, and the line that tells a sprinting player where the edge is.
        const strip = new PlaneGeometry(length, 1.4);
        strip.rotateY(side > 0 ? -Math.PI / 2 : Math.PI / 2);
        strip.translate(
          side * (halfWidth - 0.15),
          COURSE.wallHeight - COURSE.floorThickness - 1.2,
          centreZ,
        );
        strips.push(strip);
      }
    };

    /**
     * A shoulder wall where the world changes width.
     *
     * Without one, a wide area meets a narrow corridor with an open gap either
     * side and the player looks straight out of the map. Built from the SAME
     * two widths the boundary uses, so it always exactly closes the step.
     */
    const shoulder = (wideHalf: number, narrowHalf: number, atZ: number): void => {
      const span = wideHalf - narrowHalf;
      if (span <= 0.01) return;
      for (const side of [-1, 1]) {
        const piece = texturedBox(span, COURSE.wallHeight, thickness, TILE);
        piece.translate(
          side * (narrowHalf + span / 2),
          COURSE.wallHeight / 2 - COURSE.floorThickness,
          atZ,
        );
        walls.push(piece);
      }
    };

    // Walk the world from the arena's back wall to the end, splitting at every
    // change of width. The spans come from WIDE_AREAS - the same list the
    // movement clamp reads - so a wall can never end up somewhere the boundary
    // is not.
    const end = COURSE_END_Z + 10;
    const boundaries = [COURSE.lobbyStartZ, end];
    for (const area of WIDE_AREAS) boundaries.push(area.minZ, area.maxZ);
    const marks = [...new Set(boundaries)]
      .filter((z) => z >= COURSE.lobbyStartZ && z <= end)
      .sort((a, b) => a - b);

    for (let i = 0; i < marks.length - 1; i += 1) {
      const fromZ = marks[i] as number;
      const toZ = marks[i + 1] as number;
      if (toZ - fromZ < 0.01) continue;
      // Sampled at the MIDDLE of the span: a boundary value would land exactly
      // on the edge of a wide area and could resolve either way.
      const halfWidth = corridorHalfWidthAt((fromZ + toZ) / 2);
      run(halfWidth, fromZ, toZ);

      const nextZ = marks[i + 2];
      const nextHalf =
        nextZ === undefined ? halfWidth : corridorHalfWidthAt((toZ + nextZ) / 2);
      if (nextHalf > halfWidth) shoulder(nextHalf, halfWidth, toZ - thickness / 2);
      else shoulder(halfWidth, nextHalf, toZ + thickness / 2);
    }

    // The arena's back wall - the one the scoreboards hang on.
    const back = texturedBox(
      COURSE.lobbyHalfWidth * 2 + thickness * 2,
      COURSE.wallHeight,
      thickness,
      TILE,
    );
    back.translate(
      0,
      COURSE.wallHeight / 2 - COURSE.floorThickness,
      COURSE.lobbyStartZ - thickness / 2,
    );
    walls.push(back);

    this.addMerged(walls, this.stoneMaterial(), true);
    this.addMerged(
      strips,
      this.keepMaterial(
        new MeshBasicMaterial({
          color: PALETTE.neonCyan,
          transparent: true,
          opacity: 0.55,
          side: DoubleSide,
          depthWrite: false,
        }),
      ),
      false,
    );
  }

  private addMerged(
    geometries: BufferGeometry[],
    material: Material,
    receiveShadow: boolean,
  ): void {
    if (geometries.length === 0) return;
    const merged = mergeGeometries(geometries, false);
    for (const geometry of geometries) geometry.dispose();
    if (!merged) return;
    this.geometries.push(merged);
    const mesh = new Mesh(merged, material);
    mesh.receiveShadow = receiveShadow;
    this.root.add(mesh);
  }

  /** One material per kind, built once and remembered for disposal. */
  private materialFor(kind: SolidKind): Material {
    switch (kind) {
      case 'carpet':
        return this.texturedMaterial(
          this.textures.carpet(PALETTE.carpet, PALETTE.carpetWeave),
        );
      case 'plaza':
        return this.texturedMaterial(this.textures.tiles(PALETTE.plaza, PALETTE.plazaLine));
      case 'deck':
        return this.texturedMaterial(
          this.textures.planks(PALETTE.plank, PALETTE.plankDark, PALETTE.plankSpeck),
        );
      case 'plank':
        return this.texturedMaterial(
          this.textures.planks(PALETTE.plank, PALETTE.plankDark, PALETTE.plankSpeck),
        );
      case 'riser':
      case 'metal':
        return this.chromeMaterial();
      case 'glass':
        return this.glassMaterial();
      case 'pillar':
      case 'stage':
        return this.stoneMaterial();
      case 'tile':
      default:
        // The upgrade tiles draw their own rim and glow in `UpgradeTiles`; the
        // pad underneath is plain, so the neon on top is the thing that reads.
        return this.solidMaterial(0x1a2033);
    }
  }

  /**
   * The lit dance glass.
   *
   * The one emissive floor in the world. Glass that took the scene's lighting
   * like everything else would be a dark grey slab in a dark scene - and the
   * whole point of the panels is that the player can see their edges, because
   * there are real gaps between them.
   */
  private glassMaterial(): Material {
    const map = this.textures.danceGlass(PALETTE.glass, PALETTE.glassAlt);
    const material = new MeshLambertMaterial({ map });
    material.emissive.setHex(0x6b3fd4);
    material.emissiveIntensity = 0.5;
    material.emissiveMap = map;
    return this.keepMaterial(material);
  }

  private chromeMaterial(): Material {
    return this.texturedMaterial(
      this.textures.chrome(PALETTE.chrome, PALETTE.chromeDark, PALETTE.chromeSpeck),
    );
  }

  private stoneMaterial(): Material {
    return this.texturedMaterial(this.textures.stone(PALETTE.stage, PALETTE.stageDark));
  }

  private texturedMaterial(map: Texture): Material {
    return this.keepMaterial(new MeshLambertMaterial({ map }));
  }

  private solidMaterial(color: number): Material {
    return this.keepMaterial(new MeshLambertMaterial({ color }));
  }

  private keepMaterial<T extends Material>(material: T): T {
    this.materials.push(material);
    return material;
  }
}

/** A solid's box, positioned in world space. */
const boxFor = (solid: CourseSolid, tile: number): BufferGeometry => {
  const geometry = texturedBox(
    solid.maxX - solid.minX,
    solid.maxY - solid.minY,
    solid.maxZ - solid.minZ,
    tile,
  );
  geometry.translate(
    (solid.minX + solid.maxX) / 2,
    (solid.minY + solid.maxY) / 2,
    (solid.minZ + solid.maxZ) / 2,
  );
  return geometry;
};

export { STAGES, TRAINING };
