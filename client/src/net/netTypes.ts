import type { AvatarSlot, PlayerAnimationState, PlayerMotionState } from '@moonwalk/shared';
import type { MapSchema } from '@colyseus/schema';

/**
 * Client-side TYPE mirror of the server's Colyseus schema.
 *
 * These are types only - colyseus.js builds the concrete schema instances at
 * runtime from the handshake reflection, so there is no duplicated schema
 * class to keep in sync, only this shape.
 */
export interface NetPlayerState extends PlayerMotionState {
  sessionId: string;
  /**
   * Bloxity display name, verified server-side. '' when unknown.
   *
   * THE name this player is shown by - over their character, on the boards,
   * everywhere. There is no other one.
   */
  displayName: string;
  /** Their Bloxity profile picture, verified server-side. '' when unknown. */
  avatarUrl: string;
  /** What their character wears. Replicated, so everyone draws everyone. */
  avatar: NetAvatarState;
  x: number;
  y: number;
  z: number;
  /** Yaw of TRAVEL. The body is drawn facing the other way - see the moonwalk. */
  rotationY: number;
  animation: PlayerAnimationState;

  level: number;
  rebirths: number;
  wins: number;
  totalSpeed: number;
  /** Equipped speed tier - the best upgrade tile owned. */
  tierSlot: number;
  /** Bitmask of upgrade tiles bought. */
  ownedTiers: number;
  speedPerStep: number;
  moveMultiplier: number;
  jumpVelocity: number;
  maxLevel: number;
  bestStage: number;
  /** Stages banked since the last placement, so the client knows what to ask. */
  stageProgress: number;

  /** Authoritative velocity, used to reconcile client prediction. */
  velocityX: number;
  velocityY: number;
  velocityZ: number;
  /** Highest input sequence the server has simulated. */
  lastInputSeq: number;
  /** Latched jump edge, so replay resumes from the server's own edge state. */
  jumpLatched: boolean;
  /** Coyote window left, so a replayed jump off a lip is allowed identically. */
  coyote: number;
  ready: boolean;
}

/**
 * A character's appearance, as replicated.
 *
 * FLAT, because Colyseus schema fields are: the nine slots and the seven
 * proportions are their own fields rather than nested objects, and
 * `readAvatar` in `NetworkClient` is the one place that folds them back into
 * the `AvatarLook` everything else speaks.
 */
export type NetAvatarState = Record<AvatarSlot, string> & {
  bloxity: boolean;
  height: number;
  shoulderWidth: number;
  armLength: number;
  legOffsetX: number;
  torsoScaleX: number;
  neckHeight: number;
  headScale: number;
};

/** One row of one leaderboard, exactly as the server ranked it. */
export interface NetLeaderEntry {
  /** The player's Bloxity display name, or 'Guest'. Never an id. */
  name: string;
  /** Their Bloxity profile picture, or ''. */
  avatar: string;
  value: number;
}

/** The three boards on the spawn wall. Read-only, and entirely the server's. */
export interface NetLeaderboardState {
  wins: ArrayLike<NetLeaderEntry>;
  speed: ArrayLike<NetLeaderEntry>;
  rebirths: ArrayLike<NetLeaderEntry>;
}

export interface NetCourseState {
  players: MapSchema<NetPlayerState>;
  /** The clock every disco ball is a pure function of. */
  elapsed: number;
  leaderboard: NetLeaderboardState;
}

/** A leaderboard flattened into plain data, ready to draw. */
export interface LeaderboardSnapshot {
  wins: readonly NetLeaderEntry[];
  speed: readonly NetLeaderEntry[];
  rebirths: readonly NetLeaderEntry[];
}

/** Connection lifecycle, surfaced to the UI. */
export type ConnectionStatus =
  | 'idle'
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'disconnected'
  | 'error';
