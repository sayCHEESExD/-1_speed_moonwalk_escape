import { STAGES, hasCrossedFinish, type StageDefinition } from '@moonwalk/shared';
import type { PlayerState } from '../rooms/state/PlayerState.js';
import { wallet } from './Wallet.js';

/** How a claim was resolved, for logging and for the award message. */
export interface StageAward {
  readonly granted: boolean;
  readonly stage: StageDefinition | null;
  readonly wins: number;
  readonly reason?: 'unknown-stage' | 'out-of-order' | 'not-past-line';
}

/**
 * Server authority over stage rewards.
 *
 * Wins are granted in exactly one place: here. A claim is validated against
 * the player's own run progress and the position the SERVER simulated, and
 * only then does `wallet.add` run. The client only ever asks.
 *
 * There is no teleport behind a finish banner. Crossing one leaves the player
 * running straight into the next stage - which is what "advances them to the
 * next stage" means and what makes the course feel like one continuous run -
 * so "already paid" cannot be enforced by moving anybody away from the line.
 * `player.stageProgress` enforces it instead: a stage pays once per visit to
 * the arena, and the ONLY claimable stage is the one immediately after the
 * last one banked.
 *
 * That ordering does a second job. A player at four hundred units a second
 * crosses two banners inside one server tick, and a claim that merely checked
 * "am I past this line" would let both be asked for at once, in any order, or
 * twice. Requiring `progress + 1` makes the sequence the validation.
 */
export class StageService {
  /**
   * Begin a run.
   *
   * Called on join and on every placement at the arena. Resetting progress to
   * zero is what makes the whole ladder payable again on the next attempt -
   * the reward is for RUNNING the stage, not for having once reached it.
   */
  beginRun(player: PlayerState): void {
    player.stageProgress = 0;
  }

  /**
   * Resolve a claim. The server decides; the client only asked.
   */
  claim(player: PlayerState, stageIndex: number): StageAward {
    const index = Math.floor(stageIndex);
    const stage = STAGES[index - 1];
    if (!stage || stage.index !== index) {
      return { granted: false, stage: null, wins: 0, reason: 'unknown-stage' };
    }

    // Exactly the next one, and nothing else. This is both the anti-double-pay
    // rule and the anti-skip rule, in one comparison.
    if (index !== player.stageProgress + 1) {
      return { granted: false, stage, wins: 0, reason: 'out-of-order' };
    }

    // THE position check, against the transform the server itself simulated.
    // A crossing test rather than a volume test, so no speed can outrun it.
    if (!hasCrossedFinish(player.z, stage)) {
      return { granted: false, stage, wins: 0, reason: 'not-past-line' };
    }

    const granted = wallet.add(player, stage.winReward);
    player.stageProgress = index;
    if (index > player.bestStage) player.bestStage = index;

    return { granted: true, stage, wins: granted };
  }
}
