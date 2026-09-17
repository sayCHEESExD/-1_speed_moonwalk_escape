/**
 * The boards on the arena's back wall.
 *
 * A player is shown by their BLOXITY DISPLAY NAME and nothing else. This game
 * used to derive a handle - `@SwiftGallop_2F91` - from the browser-stored id,
 * because there were no accounts and a board still had to call people
 * something. There are accounts now: Bloxity's, verified server-side, and a
 * second name for the same person is a second identity system. The id it was
 * derived from stays where it always was - on the server, for persistence -
 * and is never shown.
 */

/** How many places each board shows. Matches the reference art's nine rows. */
export const LEADERBOARD_SIZE = 9;

/**
 * What someone with no Bloxity identity is called.
 *
 * Not a generated name and deliberately not unique: a player who has not
 * signed in has not told us who they are, and inventing an identity for them
 * is the thing this file exists to stop. Signing in gives them their real name
 * on every board.
 */
export const GUEST_NAME = 'Guest';
