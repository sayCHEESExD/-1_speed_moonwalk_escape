import {
  CanvasTexture,
  FrontSide,
  LinearFilter,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  SRGBColorSpace,
} from 'three';

/** One line of text on a sign. */
export interface SignLine {
  readonly text: string;
  /** Relative share of the panel's height this line takes. */
  readonly size: number;
  readonly fill: string;
  /** Outline colour. The chunky dark rim every label in the game has. */
  readonly stroke: string;
  /** Outline width, as a fraction of the font size. */
  readonly strokeWidth?: number;
}

/**
 * A floating text panel, drawn on a canvas.
 *
 * All of this game's world text - the finish banners, the "+N SPEED" over each
 * upgrade tile, the treadmill labels, the leaderboards - is one of these.
 * Canvas rather than a font file because the style is a heavy stroked display
 * face a browser can draw directly, and because a font file would be the single
 * largest asset in a build that otherwise has almost none.
 *
 * Unlit on purpose. This world is a night scene with very little ambient light,
 * and a sign that took the scene's lighting would be unreadable everywhere
 * except directly under a spotlight.
 */
export class CanvasSign {
  readonly mesh: Mesh;

  private readonly canvas: HTMLCanvasElement;
  private readonly texture: CanvasTexture;
  private readonly material: MeshBasicMaterial;
  private readonly geometry: PlaneGeometry;

  /**
   * @param width  panel width in world units
   * @param height panel height in world units
   * @param lines  what to draw, top to bottom
   */
  constructor(width: number, height: number, lines: readonly SignLine[]) {
    // Enough resolution that a small label is still crisp up close. The canvas
    // is kept so the sign can be redrawn, which costs a few hundred kilobytes
    // of heap for the handful of signs that actually change.
    const pixelsPerUnit = 64;
    this.canvas = document.createElement('canvas');
    this.canvas.width = Math.max(2, Math.round(width * pixelsPerUnit));
    this.canvas.height = Math.max(2, Math.round(height * pixelsPerUnit));

    this.texture = new CanvasTexture(this.canvas);
    this.texture.colorSpace = SRGBColorSpace;
    this.texture.anisotropy = 8;
    // No mipmaps: a sign is nearly always seen at a shallow angle from a
    // distance, and the blurred chain is what makes small labels mush.
    this.texture.generateMipmaps = false;
    this.texture.minFilter = LinearFilter;

    this.geometry = new PlaneGeometry(width, height);
    this.material = new MeshBasicMaterial({
      map: this.texture,
      transparent: true,
      // Single-sided. A double-sided panel is legible from the front and
      // MIRRORED from behind, which is worse than not being there at all.
      side: FrontSide,
      depthWrite: false,
    });

    this.mesh = new Mesh(this.geometry, this.material);
    this.redraw(lines);
  }

  /**
   * Draw new text onto the existing panel.
   *
   * Reuses the canvas, the texture and the mesh - only the pixels change, and
   * the GPU gets one re-upload. Callers must treat this as EXPENSIVE and call
   * it when something actually changed, never per frame: an upgrade tile that
   * repainted on every state patch would re-upload ten textures twenty times a
   * second to show the same numbers.
   */
  redraw(lines: readonly SignLine[]): void {
    const ctx = this.canvas.getContext('2d');
    if (!ctx) return;
    drawLines(ctx, this.canvas.width, this.canvas.height, lines);
    this.texture.needsUpdate = true;
  }

  dispose(): void {
    this.texture.dispose();
    this.material.dispose();
    this.geometry.dispose();
    this.mesh.removeFromParent();
  }
}

const FONT = '"Arial Black", "Segoe UI", system-ui, sans-serif';

/**
 * Draw the lines, sized to FIT.
 *
 * The bug this exists to prevent: sizing a line from its height band alone and
 * then drawing it centred. Nothing measured the result against the panel's
 * WIDTH, so any long string - "STAGE 10 — GRAND FINALE", "1.5M WINS", "+15K
 * SPEED" on a narrow label - simply ran off both ends of the canvas and was
 * clipped by the texture edge. The stroke makes it worse: `strokeText` paints
 * half a line width OUTSIDE the glyphs, so even text that technically fitted
 * lost the outline on its first and last characters.
 *
 * So: reserve padding for the stroke, measure, and shrink until it fits. The
 * panels themselves are also authored wide enough that the shrink rarely has
 * to do anything - the fix for clipped text is never "make the text smaller",
 * that is the symptom treated as the cure.
 */
const drawLines = (
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  lines: readonly SignLine[],
): void => {
  ctx.clearRect(0, 0, width, height);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  ctx.miterLimit = 2;

  // Lines share the panel by their own heights, so a big figure and a small
  // caption divide it proportionally rather than by a fixed grid.
  const total = lines.reduce((sum, line) => sum + line.size, 0) || 1;
  let cursor = 0;

  for (const line of lines) {
    const band = (line.size / total) * height;
    const strokeRatio = line.strokeWidth ?? 0.16;
    const centreY = cursor + band / 2;
    cursor += band;
    if (!line.text) continue;

    let fontSize = band * 0.8;

    // Converge on a size whose glyphs AND outline sit inside the panel. Four
    // passes is plenty: each one scales by the exact overflow ratio.
    for (let pass = 0; pass < 4; pass += 1) {
      ctx.font = `900 ${fontSize}px ${FONT}`;
      const drawn = ctx.measureText(line.text).width + fontSize * strokeRatio;
      const room = width * 0.94;
      if (drawn <= room) break;
      fontSize *= room / drawn;
    }

    ctx.font = `900 ${fontSize}px ${FONT}`;
    ctx.lineWidth = fontSize * strokeRatio;
    ctx.strokeStyle = line.stroke;
    ctx.strokeText(line.text, width / 2, centreY);
    ctx.fillStyle = line.fill;
    ctx.fillText(line.text, width / 2, centreY);
  }
};
