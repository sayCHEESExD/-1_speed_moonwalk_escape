/**
 * A player's PUBLIC identity: the name over their head and on the boards, and
 * the portrait beside it.
 *
 * Deliberately two strings and nothing else. The Bloxity account id, the email
 * and the auth token all exist on the client and none of them come near this
 * file: a name and a picture are what other players already see in the portal,
 * and they are everything a nameplate or a board row needs.
 *
 * THE CLIENT'S WORD, not the server's, and that is a deliberate correction.
 * The server used to set this only from a token it resolved with Bloxity, and
 * the effect in a real session was that everybody appeared as a guest: there
 * is no verified server-to-server route that answers "who is this socket", so
 * insisting on one meant no player ever got their name. It is acceptable for
 * the same reason a look is: a name DECIDES NOTHING. It chooses text on a sign
 * and can never touch a reward. The Bloxity token is still verified on the
 * server, and it still governs the one thing that is worth money - who a Bux
 * purchase is granted to.
 */

/** Longest name a nameplate or a board row is asked to hold, in characters. */
export const DISPLAY_NAME_MAX = 20;

/**
 * Client -> server: "this is who I am in the portal".
 *
 * Sent with the join, and again whenever the portal reports a login, a logout
 * or a new portrait. Both fields are empty for a signed-out player, and the
 * boards then show `GUEST_NAME`.
 */
export interface SetIdentityMessage {
  name: string;
  pfp: string;
}

/**
 * A display name, or the empty string.
 *
 * Letters and digits in any script, plus space, underscore, dot and hyphen -
 * which covers every name the portal hands out while refusing the things a
 * name has no business carrying: control characters, markup, bidirectional
 * overrides and zero-width joiners that let one name impersonate another.
 * Bounded in CHARACTERS, not UTF-16 units, so a name in a non-Latin script is
 * not cut in half through a surrogate pair.
 */
export const sanitiseDisplayName = (raw: unknown): string => {
  if (typeof raw !== 'string') return '';
  const cleaned = raw
    .normalize('NFKC')
    .replace(/[^\p{L}\p{N} _.-]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
  return Array.from(cleaned).slice(0, DISPLAY_NAME_MAX).join('').trim();
};

/**
 * Where Bloxity serves portraits from.
 *
 * The SDK builds every `pfp` it hands out on this origin, so anything else is
 * not a Bloxity portrait. The trailing slash is load-bearing: without it
 * `https://static.bloxity.io.example.com` would pass the prefix test.
 */
const PFP_HOST = 'https://static.bloxity.io';
const PFP_ORIGIN = `${PFP_HOST}/`;

/** Longest portrait URL accepted. The SDK's signed avatar paths run long. */
const PFP_MAX_LENGTH = 512;

/**
 * A Bloxity portrait URL, or the empty string.
 *
 * This string is replicated to every client and put into an image element on
 * each of their screens, so an unrestricted one would let any player make the
 * whole room fetch an address of their choosing. Pinning the origin makes the
 * worst case "somebody else's Bloxity portrait", and the character whitelist
 * keeps quotes, spaces and angle brackets out of it altogether.
 */
export const sanitisePfpUrl = (raw: unknown): string => {
  if (typeof raw !== 'string') return '';
  const given = raw.trim();
  if (given.length === 0 || given.length > PFP_MAX_LENGTH) return '';
  /*
   * A ROOT-RELATIVE path is resolved onto Bloxity's asset host rather than
   * refused. The SDK hands out absolute portraits today, but the API it reads
   * them from stores them as paths (`/img/pfps/....png`) - and a portrait
   * dropped for that reason is a player with no icon beside their name for no
   * reason the player could ever discover. `//host/…` is NOT a path: it is an
   * origin in disguise, so it is refused with everything else.
   */
  const url = given.startsWith('/') && !given.startsWith('//') ? `${PFP_HOST}${given}` : given;
  if (url.length > PFP_MAX_LENGTH) return '';
  if (!url.startsWith(PFP_ORIGIN)) return '';
  return /^[A-Za-z0-9._~:/?#@!$&*+,;=%-]+$/.test(url) ? url : '';
};
