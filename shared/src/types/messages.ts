import type { AvatarLook } from '../config/avatar.js';

/**
 * Client -> server input (MessageType.Move).
 *
 * INPUT ONLY. There is deliberately no position, velocity or rotation here:
 * the server simulates movement from intent and owns the result, so a client
 * has no channel through which to assert where it is.
 *
 * `seq` lets the server tell the client which inputs it has consumed, which is
 * what makes client-side prediction reconcilable.
 */
export interface MoveMessage {
  /** Monotonically increasing input sequence number. */
  seq: number;
  /** Seconds this input covers. Clamped and rate-limited server-side. */
  dt: number;
  /** -1..1, camera-relative. */
  moveX: number;
  /** -1..1, camera-relative. */
  moveZ: number;
  jump: boolean;
  sprint: boolean;
  /** Yaw the camera faced, so movement is camera-relative. */
  cameraYaw: number;
}

/** Why a run ended. */
export type RespawnReason =
  /** Fell off the carpet. */
  | 'fell'
  /** Hit a disco ball. */
  | 'hazard'
  /**
   * Caught by the guard.
   *
   * A separate reason from `hazard` even though both end the same way, because
   * the guard is the one death the SERVER did not decide: it is simulated on
   * the catching player's own machine and reported as a request. Logging the
   * two apart is what makes "why did I get sent back" answerable.
   */
  | 'guard'
  /** Asked to be put back. */
  | 'manual'
  /** Just joined. */
  | 'join'
  /** Rebirthed, which resets the run as well as the level curve. */
  | 'rebirth';

/** Server -> client authoritative respawn (MessageType.Respawn). */
export interface RespawnMessage {
  x: number;
  y: number;
  z: number;
  rotationY: number;
  reason: RespawnReason;
}

/**
 * Client -> server: "I crossed this stage's finish banner."
 *
 * A request, never a grant. The server checks the stage index against the
 * player's own run progress, and the finish line against the position it has
 * itself simulated, then awards the Wins.
 */
export interface ClaimStageMessage {
  stageIndex: number;
}

/**
 * Client -> server: "I glided onto this upgrade tile, sell it to me."
 *
 * A request, never a grant. The server checks the slot, the player's Wins and
 * that they are actually standing on that tile.
 */
export interface BuyUpgradeMessage {
  slot: number;
}

/** Server -> client: a stage reward landed. Presentation only. */
export interface StageAwardedMessage {
  stageIndex: number;
  wins: number;
  /** Wins the player now holds, so the HUD can pop without waiting a patch. */
  total: number;
}

/**
 * Client -> server: "rebirth me".
 *
 * Deliberately empty. The server knows the level and the rebirth count, and it
 * is the only thing allowed to decide whether the requirement is met - so
 * there is nothing in this message that could be wrong.
 */
export type RebirthMessage = Record<string, never>;

/**
 * Client -> server: the player's Bloxity token, after a login or logout.
 *
 * A TOKEN, not an id: the server resolves it with Bloxity, so nobody can claim
 * another account's paid-for Bux grants by naming its id. Empty means logged out.
 */
/**
 * What the sender's character wears, for everyone else to draw.
 *
 * Sanitised by the server with `sanitiseAvatarLook` before it reaches state:
 * ids become URLs on every other client, and proportions become scales.
 */
export type AvatarLookMessage = AvatarLook;

export interface BloxityIdentityMessage {
  token: string;
}

/**
 * Client -> server: "put me back at the arena".
 *
 * Carries no position and no reason the server acts on. It is what the local
 * guard uses when it catches its player, and what a stuck client uses to ask
 * for a placement - in both cases the server decides where anybody goes.
 */
export interface RequestRespawnMessage {
  /** Why the client is asking. Logged; it never changes the destination. */
  reason?: 'guard' | 'manual';
}
