import {
  COURSE,
  FINISH_BANNER,
  STAGES,
  corridorHalfWidthAt,
  formatSpeed,
  type StageDefinition,
} from '@moonwalk/shared';
import {
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  PlaneGeometry,
  type BufferGeometry,
  type Material,
} from 'three';
import { PALETTE } from '../config/worldVisuals.js';
import { CanvasSign } from './CanvasSign.js';
import { texturedBox } from './texturedBox.js';

/** How fast the banner's glow breathes, in cycles per second. */
const PULSE_RATE = 0.55;

/**
 * The finish banner at the end of every stage.
 *
 * A large TRANSPARENT sheet spanning the entire corridor, wall to wall, with
 * the reward printed across it - so the thing that pays is the thing the
 * player is already running at, and there is nothing to find, no corner to
 * visit and no small pad to walk into.
 *
 * It is pure scenery. What actually pays is `hasCrossedFinish`, a crossing
 * test on the player's Z that the server re-runs against its own simulated
 * position. That split is deliberate: at four hundred units a second a player
 * can pass through this sheet inside a single frame, and a banner that had to
 * be TOUCHED would simply stop paying the fastest players - which is precisely
 * backwards for a reward whose whole purpose is to reward speed.
 *
 * The sheet is DOUBLE-sided, unlike every other sign in the game. World signs
 * are single-sided because a mirrored panel read from behind is worse than no
 * panel; a banner is different, because the player is meant to see it from the
 * far side too - that view is the confirmation that the stage is banked.
 */
export class FinishBanners {
  readonly root = new Group();

  private readonly sheets: Mesh[] = [];
  private readonly signs: CanvasSign[] = [];
  private readonly geometries: BufferGeometry[] = [];
  private readonly materials: Material[] = [];

  private time = 0;

  constructor() {
    for (const stage of STAGES) this.build(stage);
  }

  /** Breathe the glow, so a banner is visible from a long way down the carpet. */
  update(delta: number): void {
    this.time += delta;
    const pulse = 0.5 + 0.5 * Math.sin(this.time * Math.PI * 2 * PULSE_RATE);
    for (const sheet of this.sheets) {
      const material = sheet.material as MeshBasicMaterial;
      material.opacity = 0.16 + pulse * 0.14;
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

  private build(stage: StageDefinition): void {
    // Sampled at the banner's own Z, so a banner inside a wide arena spans the
    // arena rather than stopping short of it at the corridor's width.
    const halfWidth = corridorHalfWidthAt(stage.finishZ);
    const span = halfWidth * 2;
    const baseY = COURSE.floorY + FINISH_BANNER.clearance;

    // The sheet: a translucent wall of light the player runs straight through.
    const sheetGeometry = this.keep(new PlaneGeometry(span, FINISH_BANNER.height));
    const sheetMaterial = this.keepMaterial(
      new MeshBasicMaterial({
        color: stageColour(stage.index),
        transparent: true,
        opacity: 0.22,
        side: DoubleSide,
        depthWrite: false,
      }),
    );
    const sheet = new Mesh(sheetGeometry, sheetMaterial);
    sheet.position.set(0, baseY + FINISH_BANNER.height / 2, stage.finishZ);
    this.root.add(sheet);
    this.sheets.push(sheet);

    // The two posts, standing OUTSIDE the corridor so nothing to run into.
    const postHeight = FINISH_BANNER.height + FINISH_BANNER.clearance + 2;
    const postGeometry = this.keep(
      texturedBox(FINISH_BANNER.postHalf * 2, postHeight, FINISH_BANNER.postHalf * 2, 4),
    );
    const postMaterial = this.keepMaterial(
      new MeshLambertMaterial({ color: PALETTE.chromeDark }),
    );
    for (const side of [-1, 1]) {
      const post = new Mesh(postGeometry, postMaterial);
      post.position.set(
        side * (halfWidth + FINISH_BANNER.postOverhang),
        COURSE.floorY + postHeight / 2,
        stage.finishZ,
      );
      post.castShadow = true;
      this.root.add(post);
    }

    // The header beam across the top, and the neon strip under it.
    const beamGeometry = this.keep(
      texturedBox(span + FINISH_BANNER.postOverhang * 2, 2.4, 2.2, 4),
    );
    const beam = new Mesh(beamGeometry, postMaterial);
    beam.position.set(0, baseY + FINISH_BANNER.height + 1.2, stage.finishZ);
    this.root.add(beam);

    const stripGeometry = this.keep(new PlaneGeometry(span, 0.9));
    const stripMaterial = this.keepMaterial(
      new MeshBasicMaterial({ color: stageColour(stage.index), side: DoubleSide }),
    );
    const strip = new Mesh(stripGeometry, stripMaterial);
    strip.position.set(0, baseY + 0.5, stage.finishZ);
    this.root.add(strip);

    /*
     * The reward, printed large across the banner.
     *
     * Formatted like every other big figure the player reads: the last stage
     * pays a million, and "+1000000 Wins" is a number nobody parses at a
     * sprint. Two lines - what the stage is called, and what it pays - with
     * the PAYMENT the larger of the two, because that is what the player is
     * running for.
     */
    const label = new CanvasSign(Math.min(span * 0.72, 46), 11, [
      {
        text: `STAGE ${stage.index} — ${stage.name.toUpperCase()}`,
        size: 0.42,
        fill: '#ffffff',
        stroke: '#12060f',
        strokeWidth: 0.16,
      },
      {
        text: `+${formatSpeed(stage.winReward)} WIN${stage.winReward === 1 ? '' : 'S'}`,
        size: 1,
        fill: '#ffe14d',
        stroke: '#2a1a02',
        strokeWidth: 0.18,
      },
    ]);
    /*
     * Turned to face BACK down the course, toward the player approaching it.
     *
     * A `PlaneGeometry` faces +Z, and the player runs toward +Z - so an
     * unrotated sign points its face away from everybody who has not yet
     * crossed, which is precisely the audience for a reward. It sits a shade
     * on the approach side of the sheet for the same reason.
     */
    label.mesh.position.set(0, baseY + FINISH_BANNER.height * 0.62, stage.finishZ - 0.15);
    label.mesh.rotation.y = Math.PI;
    this.root.add(label.mesh);
    this.signs.push(label);

    /*
     * The confirmation, on the far side, so crossing the line is ACKNOWLEDGED
     * rather than merely done.
     *
     * Left unrotated, facing +Z - which is the way a player who has already
     * crossed is looking. That is not a guess about the camera: this character
     * moonwalks, so they travel with their back to their direction of travel
     * and a banner they have just passed through is directly in front of them.
     * The one place in this game where the dance changes what a sign should
     * face.
     */
    const behind = new CanvasSign(Math.min(span * 0.72, 46), 11, [
      {
        text: `STAGE ${stage.index} CLEARED`,
        size: 0.5,
        fill: '#ffffff',
        stroke: '#12060f',
        strokeWidth: 0.16,
      },
      {
        text: `NEXT: STAGE ${stage.index + 1}`,
        size: 0.6,
        fill: '#2dd4ff',
        stroke: '#04202b',
        strokeWidth: 0.16,
      },
    ]);
    behind.mesh.position.set(0, baseY + FINISH_BANNER.height * 0.62, stage.finishZ + 0.15);
    this.root.add(behind.mesh);
    this.signs.push(behind);
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
 * The neon a stage's banner is lit in.
 *
 * Cycles through the palette's accents, so consecutive banners never share a
 * colour and a player glancing back knows which one they just crossed.
 */
const BANNER_COLOURS = [
  PALETTE.neonPink,
  PALETTE.neonCyan,
  PALETTE.neonGold,
  PALETTE.neonViolet,
  PALETTE.neonGreen,
] as const;

const stageColour = (index: number): number =>
  BANNER_COLOURS[(Math.max(1, index) - 1) % BANNER_COLOURS.length] as number;
