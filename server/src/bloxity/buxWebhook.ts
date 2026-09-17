import { timingSafeEqual } from 'node:crypto';
import type { BuxGrants } from './BuxGrants.js';

/** Where Bloxity delivers a paid purchase. */
export const BUX_WEBHOOK_PATH = '/bloxity/bux';

export interface WebhookResult {
  readonly status: number;
  readonly body: Record<string, unknown>;
}

export interface WebhookOptions {
  /** The shared secret configured on bloxity.io, or '' if none. */
  readonly secret: string;
  /** Accept an unsigned webhook when no secret is configured. Local development only. */
  readonly allowUnsigned: boolean;
}

/**
 * Decide what to do with one fulfilment webhook.
 *
 * Pure apart from `grants`, so it is tested without a socket.
 *
 * ANSWERING 2xx IS THE CONTRACT: Bloxity refunds a purchase whose webhook did
 * not succeed. So anything safely RECORDED is 2xx - including a SKU this build
 * does not know, which is far likelier to be a catalogue ahead of a deploy than
 * an attack. The non-2xx answers are the cases where a refund is correct: a bad
 * secret, an unrecordable body, or a server with no secret configured at all,
 * which would otherwise grant Wins to anyone who found the URL.
 */
export const processBuxWebhook = (
  suppliedSecret: string | undefined,
  rawBody: string,
  grants: BuxGrants,
  options: WebhookOptions,
): WebhookResult => {
  if (options.secret) {
    if (!suppliedSecret || !safeEqual(suppliedSecret, options.secret)) {
      return { status: 401, body: { ok: false, error: 'bad secret' } };
    }
  } else if (!options.allowUnsigned) {
    return { status: 503, body: { ok: false, error: 'webhook secret not configured' } };
  }

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(rawBody) as Record<string, unknown>;
  } catch {
    return { status: 400, body: { ok: false, error: 'malformed payload' } };
  }

  const transactionId = payload['transactionId'];
  const userId = payload['userId'];
  const sku = payload['sku'];
  if (typeof transactionId !== 'string' || !transactionId || typeof userId !== 'string' || !userId || typeof sku !== 'string' || !sku) {
    return { status: 400, body: { ok: false, error: 'missing transactionId, userId or sku' } };
  }

  const outcome = grants.record(userId, transactionId, sku);
  return { status: 200, body: { ok: true, transactionId, outcome } };
};

const safeEqual = (a: string, b: string): boolean => {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
};
