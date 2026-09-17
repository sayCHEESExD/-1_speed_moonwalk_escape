import { logger } from '../util/logger.js';

const SCOPE = 'bloxity/identity';

/** A Bloxity account, as the SERVER established it. */
export interface VerifiedBloxityUser {
  readonly id: string;
  readonly username: string;
  readonly displayName: string;
}

/**
 * Resolve a Bloxity token to the account it belongs to.
 *
 * FOR BUX, and for nothing else. What a player is CALLED arrives separately,
 * as an identity the client reports and the server sanitises - see
 * `shared/src/types/identity.ts` for why that split is the right one. This
 * answers the only question worth a round trip: which account a purchase
 * belongs to.
 *
 * The client sends its TOKEN, never its id. A claimed id would let anybody say
 * they were somebody else and collect that person's paid-for Bux grants; a
 * token can only be answered by Bloxity for the account that owns it.
 *
 * Verified by calling Bloxity's authenticated profile route with the token,
 * which was confirmed to exist before being written here: it answers 401 with
 * no token and with a forged one, while a neighbouring bogus path answers 404.
 * The success body's exact shape could not be observed without a real login,
 * so the id is read from the few shapes an API of this kind returns rather
 * than from one guessed field.
 */
export const verifyBloxityToken = async (
  token: string,
  apiBase: string,
): Promise<VerifiedBloxityUser | null> => {
  if (!token || token.length > 4096) return null;
  try {
    const response = await fetch(`${apiBase}/v1/social/profile`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(6000),
    });
    if (!response.ok) {
      logger.warn(SCOPE, `token rejected by Bloxity (HTTP ${response.status})`);
      return null;
    }
    const body = (await response.json()) as Record<string, unknown>;
    const candidate = (body['user'] ?? body['profile'] ?? body['data'] ?? body) as Record<string, unknown>;
    const id = candidate['_id'] ?? candidate['id'];
    const username = candidate['username'];
    if (typeof id !== 'string' || !id) {
      logger.warn(SCOPE, 'Bloxity profile response had no id');
      return null;
    }
    const name = typeof username === 'string' ? username : '';
    const display = typeof candidate['displayName'] === 'string' ? candidate['displayName'] : name;
    return { id, username: name, displayName: (display as string).slice(0, 40) };
  } catch (error) {
    logger.warn(SCOPE, `could not verify token: ${String(error)}`);
    return null;
  }
};
