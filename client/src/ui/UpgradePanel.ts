import { SPEED_TIERS, formatSpeed, ownsTier, type SpeedTier } from '@moonwalk/shared';
import { Panel } from './Panel.js';

/**
 * The speed upgrade ladder, as a reference sheet.
 *
 * READ ONLY, and deliberately so. Nothing is bought here: an upgrade is bought
 * by gliding onto its TILE on the right of the arena, which is the whole point
 * of doing it with tiles instead of a shop. Putting a Buy button in here would
 * quietly make the tiles decorative.
 *
 * What it is for is the question a tile cannot answer from across the room:
 * "what is the whole ladder, what does the next rung cost, and how far off am
 * I?" A player standing on tile 3 can see tile 4's price only by walking to
 * it; this is the map.
 *
 * Every figure is replicated server state. The panel never awards, predicts or
 * derives progress - a row is "affordable" when the server would accept the
 * purchase behind it right now.
 */
export class UpgradePanel extends Panel {
  private readonly rows: {
    readonly tier: SpeedTier;
    readonly root: HTMLDivElement;
    readonly status: HTMLSpanElement;
  }[] = [];

  private wins = 0;
  private owned = 0;

  constructor(parent: HTMLElement) {
    super(parent, 'upgrade', 'Speed Upgrades');

    const hint = document.createElement('p');
    hint.className = 'mwe-shop__hint mwe-font';
    hint.textContent = 'Step on a tile on your RIGHT to buy it.';
    this.body.appendChild(hint);

    const list = document.createElement('div');
    list.className = 'mwe-shop';

    for (const tier of SPEED_TIERS) {
      const row = document.createElement('div');
      row.className = 'mwe-shop__row';

      const swatch = document.createElement('span');
      swatch.className = 'mwe-shop__swatch';
      swatch.style.background = `#${tier.glow.toString(16).padStart(6, '0')}`;

      const name = document.createElement('span');
      name.className = 'mwe-shop__name mwe-font';
      name.textContent = tier.name;

      const gain = document.createElement('span');
      gain.className = 'mwe-shop__gain mwe-font';
      gain.textContent = `+${formatSpeed(tier.speedPerStep)} SPEED`;

      const status = document.createElement('span');
      status.className = 'mwe-shop__status mwe-font';

      row.append(swatch, name, gain, status);
      list.appendChild(row);
      this.rows.push({ tier, root: row, status });
    }

    this.body.appendChild(list);
    this.render();
  }

  /** Mirror the replicated wallet and inventory. */
  setInventory(wins: number, ownedTiers: number): void {
    if (wins === this.wins && ownedTiers === this.owned) return;
    this.wins = wins;
    this.owned = ownedTiers;
    this.render();
  }

  /**
   * True when at least one tile could be bought right now.
   *
   * Drives the badge on the rail tile, so the rail says "there is something to
   * collect" from exactly the same figures the panel shows.
   */
  get hasAffordable(): boolean {
    return SPEED_TIERS.some(
      (tier) => !ownsTier(this.owned, tier.slot) && this.wins >= tier.winsRequired,
    );
  }

  protected override onOpened(): void {
    this.render();
  }

  private render(): void {
    for (const row of this.rows) {
      const owned = ownsTier(this.owned, row.tier.slot);
      const affordable = !owned && this.wins >= row.tier.winsRequired;

      row.root.classList.toggle('mwe-shop__row--owned', owned);
      row.root.classList.toggle('mwe-shop__row--ready', affordable);

      if (owned) {
        row.status.textContent = 'OWNED';
        continue;
      }
      row.status.textContent =
        row.tier.winsRequired === 0
          ? 'FREE'
          : `${formatSpeed(row.tier.winsRequired)} wins`;
    }
  }
}
