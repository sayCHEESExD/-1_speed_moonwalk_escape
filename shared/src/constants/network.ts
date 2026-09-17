/**
 * Network-level constants. Must stay identical on client and server.
 */

/** Colyseus room registered by the server and joined by the client. */
export const ROOM_NAME = 'moonwalkescape';

/**
 * Default server port. Override with the PORT env var on the server.
 *
 * Deliberately NOT 2567 or 2568: the two previous games in this series already
 * answer on those, so sharing one would mean whichever server started first
 * silently served every client. This game is the third, so it is 2569.
 */
export const DEFAULT_SERVER_PORT = 2569;

/**
 * Most players in ONE room.
 *
 * The matchmaker locks a room at this figure and opens another, so a
 * sixteenth player gets a new room rather than a refusal - which is what
 * "routed, not rejected" means here.
 *
 * It lives in `shared/` because it is a fact about the world both halves have
 * to agree on: the server enforces it, and anything the client ever shows
 * about how full a room is has to be the same number or it is lying.
 */
export const MAX_PLAYERS_PER_ROOM = 15;

/** Server simulation / state broadcast rate, in Hz. */
export const SERVER_TICK_RATE = 20;

/** Milliseconds between server ticks. */
export const SERVER_TICK_MS = 1000 / SERVER_TICK_RATE;

/**
 * Client->server and server->client message identifiers.
 *
 * A const object rather than an enum so it survives `verbatimModuleSyntax` and
 * erases cleanly in both build pipelines.
 */
export const MessageType = {
  /** Client -> server: one frame of INPUT. Never a transform. */
  Move: 'move',
  /** Server -> client: authoritative respawn instruction. */
  Respawn: 'respawn',
  /** Client -> server: "I think I crossed a finish banner." A request only. */
  ClaimStage: 'claimStage',
  /** Client -> server: "I am standing on this upgrade tile, sell it to me." */
  BuyUpgrade: 'buyUpgrade',
  /** Client -> server: "put me back at the red carpet". */
  RequestRespawn: 'requestRespawn',
  /** Server -> client: a stage reward was granted. Drives the celebration. */
  StageAwarded: 'stageAwarded',
  /**
   * Client -> server: "rebirth me".
   *
   * Carries nothing: the server already knows the player's level and rebirth
   * count, and it is the only thing allowed to decide whether the requirement
   * is met.
   */
  Rebirth: 'rebirth',
  /**
   * Client -> server: "my Bloxity token is now this" (login or logout mid-session).
   * The server verifies it with Bloxity; it never trusts an id from a client.
   */
  BloxityIdentity: 'bloxityIdentity',
  /**
   * Client -> server: "this is what my character looks like".
   *
   * APPEARANCE ONLY, and the one message whose contents the server replicates
   * rather than decides. A look is what Bloxity says the player wears, which
   * the server cannot ask Bloxity for on their behalf, and there is nothing to
   * win by lying about a hat - so it is taken, clamped, and passed on.
   */
  AvatarLook: 'avatarLook',
  /**
   * Client -> server: "this is who I am in the portal" - display name and
   * portrait. Sent on join and whenever the portal reports a login or logout.
   * Accepted on the same terms as a look, and for the same reason: a name
   * decides nothing. See `shared/src/types/identity.ts`.
   */
  SetIdentity: 'setIdentity',
} as const;

export type MessageType = (typeof MessageType)[keyof typeof MessageType];
