import {
  COURSE,
  SPEED_TIERS,
  TILE_ROW,
  formatSpeed,
  ownsTier,
  tileZ,
  type SpeedTier,
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
import { CanvasSign } from './CanvasSign.js';
import { texturedBox } from './texturedBox.js';

/** How fast an affordable tile pulses, in cycles per second. */
const PULSE_RATE = 0.8;

/** One tile: the pad, its neon rim, its label and its state. */
interface Tile {
  readonly tier: SpeedTier;
  readonly rim: Mesh;
  readonly glow: Mesh;
  readonly sign: CanvasSign;
  /** The label currently drawn, so a redraw only happens on a real change. */
  state: 'locked' | 'affordable' | 'owned';
}

/**
 * The speed upgrade tiles, down the player's RIGHT.
 *
 * There are no boots, no pets and nothing worn. An upgrade is a TILE on the
 * floor: glide onto it holding enough Wins and the tier is bought, permanently,
 * with no visible effect on the character afterwards. That absence is the
 * design - this character wears one outfit and a rack of equipment hanging off
 * him would fight the whole look.
 *
 * A tile shows exactly two things, because they are the only two a player needs
 * to decide: what it GIVES (`+X SPEED`) and what it COSTS (the Wins). Both are
 * drawn from the shared ladder, so a tuning change moves the sign with it.
 *
 * Everything here is presentation. Whether a tile can be bought is decided by
 * the server against its own simulated position and its own wallet; this only
 * lights up when the server would say yes.
 */
export class UpgradeTiles {
  readonly root = new Group();

  private readonly tiles: Tile[] = [];
  private readonly geometries: BufferGeometry[] = [];
  private readonly materials: Material[] = [];

  private time = 0;
  private lastOwned = -1;
  private lastWins = -1;

  constructor() {
    for (const tier of SPEED_TIERS) this.build(tier);
  }

  /**
   * Mirror the replicated wallet and inventory.
   *
   * Redraws only on a real CHANGE. The server sends twenty patches a second
   * and a canvas re-upload per tile per patch would be the most expensive
   * thing on the client by a wide margin.
   */
  setInventory(ownedTiers: number, wins: number): void {
    if (ownedTiers === this.lastOwned && wins === this.lastWins) return;
    this.lastOwned = ownedTiers;
    this.lastWins = wins;

    for (const tile of this.tiles) {
      const owned = ownsTier(ownedTiers, tile.tier.slot);
      const next: Tile['state'] = owned
        ? 'owned'
        : wins >= tile.tier.winsRequired
          ? 'affordable'
          : 'locked';
      if (next === tile.state) continue;
      tile.state = next;
      this.repaint(tile);
    }
  }

  /** Pulse whatever the player can afford right now. */
  update(delta: number): void {
    this.time += delta;
    const pulse = 0.5 + 0.5 * Math.sin(this.time * Math.PI * 2 * PULSE_RATE);

    for (const tile of this.tiles) {
      const material = tile.glow.material as MeshBasicMaterial;
      switch (tile.state) {
        case 'affordable':
          // Breathing: the one state that is asking to be stepped on.
          material.opacity = 0.35 + pulse * 0.5;
          break;
        case 'owned':
          material.opacity = 0.5;
          break;
        default:
          // Locked tiles are dim but never invisible - a player has to be able
          // to see what they are working toward.
          material.opacity = 0.12;
      }
    }
  }

  dispose(): void {
    for (const geometry of this.geometries) geometry.dispose();
    for (const material of this.materials) material.dispose();
    for (const tile of this.tiles) tile.sign.dispose();
    this.geometries.length = 0;
    this.materials.length = 0;
    this.tiles.length = 0;
    this.root.removeFromParent();
  }

  private build(tier: SpeedTier): void {
    const z = tileZ(tier.slot);
    const y = COURSE.floorY;

    // The pad itself is a real solid in the shared course data; this is the
    // rim and the light around it.
    const rimGeometry = this.keep(
      texturedBox(TILE_ROW.width + 1, TILE_ROW.height + 0.05, TILE_ROW.length + 1, 3),
    );
    const rimMaterial = this.keepMaterial(new MeshLambertMaterial({ color: tier.colour }));
    const rim = new Mesh(rimGeometry, rimMaterial);
    rim.position.set(TILE_ROW.x, y + TILE_ROW.height / 2, z);
    rim.receiveShadow = true;
    this.root.add(rim);

    /*
     * The glow: a flat panel just above the pad.
     *
     * Unlit and additive-feeling rather than a light source. A real light per
     * tile would be ten lights in one room, which on a phone is most of the
     * frame budget for something a flat quad conveys perfectly.
     */
    const glowGeometry = this.keep(new PlaneGeometry(TILE_ROW.width, TILE_ROW.length));
    const glowMaterial = this.keepMaterial(
      new MeshBasicMaterial({
        color: tier.glow,
        transparent: true,
        opacity: 0.2,
        side: DoubleSide,
        depthWrite: false,
      }),
    );
    const glow = new Mesh(glowGeometry, glowMaterial);
    glow.rotation.x = -Math.PI / 2;
    glow.position.set(TILE_ROW.x, y + TILE_ROW.height + 0.04, z);
    this.root.add(glow);

    // A back panel behind the row, so the labels have something to sit on.
    const panelGeometry = this.keep(texturedBox(0.6, 9, TILE_ROW.length + 1, 3));
    const panel = new Mesh(
      panelGeometry,
      this.keepMaterial(new MeshLambertMaterial({ color: tier.colour })),
    );
    panel.position.set(TILE_ROW.x - TILE_ROW.width / 2 - 1.6, y + 4.5, z);
    this.root.add(panel);

    /*
     * Narrower than the spacing between two tiles, deliberately.
     *
     * The row is ten labels down one wall at nine units apart, and a panel
     * wider than that gap overlaps its neighbours - which turned the whole
     * ladder into one unbroken ticker of run-together prices. The text inside
     * shrinks to fit (see `CanvasSign`), so the constraint that matters is the
     * PANEL's width against the row's pitch.
     */
    const sign = new CanvasSign(8, 4.4, [{ text: '', size: 1, fill: '#fff', stroke: '#000' }]);
    // Facing +X, back toward the carpet - the only direction anybody
    // approaches these from. Signs are single-sided, so one left facing +Z
    // would be invisible from the whole arena.
    sign.mesh.rotation.y = Math.PI / 2;
    sign.mesh.position.set(TILE_ROW.x - TILE_ROW.width / 2 - 1.2, y + 5.2, z);
    this.root.add(sign.mesh);

    const tile: Tile = { tier, rim, glow, sign, state: 'locked' };
    this.tiles.push(tile);
    this.repaint(tile);
  }

  /**
   * Redraw one tile's label for its current state.
   *
   * `CanvasSign` uploads a texture, so this is called on a CHANGE and never
   * per frame.
   */
  private repaint(tile: Tile): void {
    const { tier } = tile;
    const price =
      tier.winsRequired === 0 ? 'FREE' : `${formatSpeed(tier.winsRequired)} WINS`;

    const lines =
      tile.state === 'owned'
        ? [
            { text: `+${formatSpeed(tier.speedPerStep)} SPEED`, size: 1, fill: '#8affc0', stroke: '#052b16', strokeWidth: 0.17 },
            { text: 'OWNED', size: 0.5, fill: '#ffffff', stroke: '#052b16' },
          ]
        : [
            { text: `+${formatSpeed(tier.speedPerStep)} SPEED`, size: 1, fill: '#ffffff', stroke: '#1a1030', strokeWidth: 0.17 },
            {
              text: price,
              size: 0.55,
              fill: tile.state === 'affordable' ? '#ffe14d' : '#9aa4c0',
              stroke: '#1a1030',
            },
          ];

    tile.sign.redraw(lines);
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
