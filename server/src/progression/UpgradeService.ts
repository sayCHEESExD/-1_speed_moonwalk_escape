import {
  bestTier,
  ownsTier,
  tierForSlot,
  upgradeTileAt,
  withTier,
  type SpeedTier,
} from '@moonwalk/shared';
import type { PlayerState } from '../rooms/state/PlayerState.js';
import type { SpeedService } from './SpeedService.js';
import { wallet } from './Wallet.js';

/** How a purchase was resolved, for logging and for the caller. */
export interface UpgradeClaim {
  readonly granted: boolean;
  readonly tier: SpeedTier | null;
  readonly reason?: 'unknown-tier' | 'already-owned' | 'not-on-tile' | 'too-poor';
}

/**
 * Server authority over the speed upgrade tiles.
 *
 * Buying is a DELIBERATE ACT: the player must be standing on the tile while
 * holding enough Wins. Reaching the price alone does nothing, which is what
 * separates an upgrade the player chose from one that simply happened to them.
 *
 * Wins are SPENT - the price is deducted, through `wallet` like every other
 * movement of Wins in the game - and the equipped tier is always the highest
 * OWNED one, so a purchase can never downgrade anybody.
 */
export class UpgradeService {
  /** Bring a fresh or restored player's equipped tier in line with the mask. */
  initialise(player: PlayerState): void {
    this.equipBest(player);
  }

  /**
   * Resolve a purchase. The server decides; the client only asked.
   *
   * Validation order is deliberate - every deterministic check first and the
   * PAYMENT last, so nothing is deducted before every test has passed and a
   * burst of requests can never take two payments for one tile.
   */
  claim(player: PlayerState, slot: number, speeds: SpeedService): UpgradeClaim {
    const at = Math.floor(slot);
    const tier = tierForSlot(at);
    if (tier.slot !== at) return { granted: false, tier: null, reason: 'unknown-tier' };

    if (ownsTier(player.ownedTiers, at)) {
      return { granted: false, tier, reason: 'already-owned' };
    }

    // THE position check, against the transform the server itself simulated.
    // A client that claims a tile it is nowhere near is simply refused.
    if (upgradeTileAt(player.x, player.y, player.z) !== at) {
      return { granted: false, tier, reason: 'not-on-tile' };
    }

    if (!wallet.spend(player, tier.winsRequired)) {
      return { granted: false, tier, reason: 'too-poor' };
    }

    player.ownedTiers = withTier(player.ownedTiers, at);
    this.equipBest(player);
    // Movement speed, jump velocity and Speed-per-stride all re-derive through
    // the one evaluator rather than being written here.
    speeds.syncDerived(player);

    return { granted: true, tier };
  }

  /**
   * Equip the best tier the player owns.
   *
   * Called after every change to the mask and on every join. The equipped tier
   * is never stored - it is DERIVED - so a tuning change to the ladder reaches
   * returning players without a migration.
   */
  private equipBest(player: PlayerState): void {
    const tier = bestTier(player.ownedTiers);
    player.tierSlot = tier.slot;
    player.speedPerStep = tier.speedPerStep;
  }
}
