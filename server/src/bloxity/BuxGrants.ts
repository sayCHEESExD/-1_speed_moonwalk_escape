import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { logger } from '../util/logger.js';

const SCOPE = 'bux';

/**
 * What each SKU hands over, in Wins.
 *
 * The PRICE is not here and never may be: Bloxity charges from its own
 * catalogue keyed by the game slug. This is only the game's half - what a
 * bought SKU is worth in-game.
 */
export const SKU_WINS: Readonly<Record<string, number>> = {
  wins_small: 250,
  wins_large: 1500,
};

export interface PendingGrant {
  readonly transactionId: string;
  readonly sku: string;
  readonly wins: number;
}

interface StoredGrants {
  pending: Record<string, PendingGrant[]>;
  seen: string[];
}

/**
 * Purchases paid for and not yet handed over.
 *
 * A QUEUE, not a direct write: the webhook lands on the HTTP thread at a moment
 * of Bloxity's choosing, and a player who is live in a room has Wins in
 * replicated state that the next autosave writes over the stored profile. So
 * the webhook only RECORDS, and the room applies what is waiting.
 *
 * Written to disk BEFORE the webhook answers 2xx, because a 2xx is Bloxity's
 * signal that the purchase is safe - a queue held only in memory would lose a
 * paid purchase to the next restart. Transaction ids are remembered so a
 * retried webhook pays out once.
 */
export class BuxGrants {
  private readonly pending = new Map<string, PendingGrant[]>();
  private readonly seen = new Set<string>();
  private readonly path: string | null;

  /** @param path JSON file to persist to, or null to keep grants in memory (tests). */
  constructor(path: string | null) {
    this.path = path;
    this.load();
  }

  /**
   * Record a paid purchase.
   *
   * @returns 'recorded', 'duplicate' for a retried transaction, or 'unknown-sku'
   *          (still recorded as seen, so Bloxity is answered 2xx and does not
   *          refund a purchase that was genuinely made).
   */
  record(bloxityId: string, transactionId: string, sku: string): 'recorded' | 'duplicate' | 'unknown-sku' {
    if (this.seen.has(transactionId)) {
      logger.info(SCOPE, `duplicate webhook for ${transactionId}, ignored`);
      return 'duplicate';
    }
    this.seen.add(transactionId);

    const wins = SKU_WINS[sku];
    if (wins === undefined) {
      logger.warn(SCOPE, `unknown sku "${sku}" [${transactionId}] - nothing to grant`);
      this.save();
      return 'unknown-sku';
    }

    const queue = this.pending.get(bloxityId) ?? [];
    queue.push({ transactionId, sku, wins });
    this.pending.set(bloxityId, queue);
    this.save();
    logger.info(SCOPE, `queued ${sku} (+${wins} wins) for ${bloxityId} [${transactionId}]`);
    return 'recorded';
  }

  /** Take everything waiting for a player. Empties their queue. */
  drain(bloxityId: string): PendingGrant[] {
    const queue = this.pending.get(bloxityId);
    if (!queue || queue.length === 0) return [];
    this.pending.delete(bloxityId);
    this.save();
    return queue;
  }

  get hasPending(): boolean {
    return this.pending.size > 0;
  }

  private load(): void {
    if (!this.path || !existsSync(this.path)) return;
    try {
      const raw = JSON.parse(readFileSync(this.path, 'utf8')) as Partial<StoredGrants>;
      for (const [id, grants] of Object.entries(raw.pending ?? {})) {
        if (Array.isArray(grants) && grants.length > 0) this.pending.set(id, grants);
      }
      for (const id of raw.seen ?? []) this.seen.add(id);
    } catch (error) {
      logger.error(SCOPE, `could not read ${this.path}: ${String(error)}`);
    }
  }

  /** Synchronous and atomic: it must be on disk before the webhook answers. */
  private save(): void {
    if (!this.path) return;
    const data: StoredGrants = {
      pending: Object.fromEntries(this.pending),
      seen: [...this.seen],
    };
    mkdirSync(dirname(this.path), { recursive: true });
    const temp = `${this.path}.tmp`;
    writeFileSync(temp, JSON.stringify(data));
    renameSync(temp, this.path);
  }
}
