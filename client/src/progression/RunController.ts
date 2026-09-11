import {
  STAGES,
  hasCrossedFinish,
  ownsTier,
  tierForSlot,
  upgradeTileAt,
  type WorldCollision,
} from '@moonwalk/shared';
import type { LocalPlayer } from '../player/LocalPlayer.js';

/** Seconds between two requests of the same kind. */
const REQUEST_COOLDOWN = 0.4;

/** What the controller may ask the server for. It never grants anything. */
export interface RunActions {
  claimStage(stageIndex: number): void;
  buyUpgrade(slot: number): void;
}

/**
 * Turns the player's position into REQUESTS.
 *
 * The one job: notice that the player has crossed a line or stepped on a tile,
 * and ask the server about it. Every actual decision - whether the stage pays,
 * whether the tile is affordable, whether the player is really standing there
 * - is made server-side against the transform the server itself simulated.
 * Nothing here awards anything, and nothing here can.
 *
 * There are two exceptions to "ask, do not decide", and both are PREDICTIONS
 * rather than decisions:
 *
 *   - DEATH by disco ball. The client starts the fall-over the moment it can
 *     see the player is hit, because waiting a round trip means the character
 *     keeps gliding through thin air for a tenth of a second. The server still
 *     decides; this only decides when to start drawing.
 *   - The GUARD, which is not handled here at all - it lives in `guard/` and
 *     asks for a respawn directly, for the reasons set out there.
 */
export class RunController {
  private readonly collision: WorldCollision;
  private readonly actions: RunActions;

  private stageCooldown = 0;
  private tileCooldown = 0;

  /** Replicated ownership and wallet, so a request the server would refuse is
   * never sent in the first place. The server still checks both. */
  private ownedTiers = 0;
  private wins = 0;

  /**
   * Stages banked this run, mirrored from the server.
   *
   * The client asks for exactly `stageProgress + 1` and never anything else,
   * which is the same rule the server validates with. Mirroring it rather than
   * counting locally is what keeps the two in step when a request is dropped:
   * the next patch restores the truth and the next crossing asks again.
   */
  private stageProgress = 0;

  constructor(collision: WorldCollision, actions: RunActions) {
    this.collision = collision;
    this.actions = actions;
  }

  /** Mirror the replicated wallet, inventory and run progress. */
  setInventory(ownedTiers: number, wins: number, stageProgress: number): void {
    this.ownedTiers = ownedTiers;
    this.wins = wins;
    this.stageProgress = stageProgress;
  }

  /**
   * @param elapsed the server's clock, for the hazard prediction. Disco balls
   *                are a pure function of it on both sides.
   */
  update(delta: number, player: LocalPlayer, elapsed: number): void {
    this.stageCooldown = Math.max(0, this.stageCooldown - delta);
    this.tileCooldown = Math.max(0, this.tileCooldown - delta);

    // A player already dying is not in any trigger volume that matters.
    if (player.isDying) return;

    const { x, y, z } = player.position;

    // Death prediction. The server confirms it with a Respawn; this is only
    // about starting the animation on the frame the player can see it happen.
    if (this.collision.hasFallen(y) || this.collision.touchesHazard(x, y, z, elapsed)) {
      player.beginDeath();
      return;
    }

    this.checkFinishLine(z);
    this.checkUpgradeTile(x, y, z);
  }

  /**
   * Ask about the next finish banner once the player is past it.
   *
   * A CROSSING test, not a volume test, and it asks about exactly one stage -
   * the next unbanked one. At four hundred units a second a player passes
   * through two banners inside a single frame, and "am I past the line" is the
   * only formulation of this that a fast player cannot outrun.
   *
   * The cooldown is spam protection only. What actually prevents a second
   * payment is that `stageProgress` advances on the server, so the very next
   * patch makes this ask about the FOLLOWING stage instead.
   */
  private checkFinishLine(z: number): void {
    if (this.stageCooldown > 0) return;

    const next = STAGES[this.stageProgress];
    if (!next) return;
    if (!hasCrossedFinish(z, next)) return;

    this.stageCooldown = REQUEST_COOLDOWN;
    this.actions.claimStage(next.index);
  }

  /**
   * Ask about the tile the player is standing on.
   *
   * Asking for one already owned, or one the player plainly cannot afford,
   * would be a request the server refuses every frame. The server still checks
   * both - this only keeps the wire quiet.
   */
  private checkUpgradeTile(x: number, y: number, z: number): void {
    if (this.tileCooldown > 0) return;

    const slot = upgradeTileAt(x, y, z);
    if (slot === 0) return;
    if (ownsTier(this.ownedTiers, slot)) return;
    if (this.wins < tierForSlot(slot).winsRequired) return;

    this.tileCooldown = REQUEST_COOLDOWN;
    this.actions.buyUpgrade(slot);
  }
}
