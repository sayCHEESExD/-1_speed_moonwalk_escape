/**
 * Everything worth keeping about a player between sessions.
 *
 * Deliberately the DERIVING facts only: level, movement speed and the equipped
 * speed tier are all recomputed from these on load through the same formulas a
 * live session uses, so a tuning change reaches returning players too.
 */
export interface StoredProfile {
  /** Lifetime Speed farmed. Level follows from it. */
  totalSpeed: number;
  /** Stage wins banked. */
  wins: number;
  /** Bitmask of speed tiles bought. The equipped tier is the best of these. */
  ownedTiers: number;
  /** Rebirths performed. */
  rebirths: number;
  /** Highest stage ever finished. */
  bestStage: number;
  /**
   * The Bloxity display name last seen on this profile, or ''.
   *
   * Stored so the boards can name players who are not currently connected. It
   * is a CACHE of Bloxity's answer, refreshed from the verified profile on
   * every save - never an identity of this game's own, and never what anything
   * is keyed by.
   */
  displayName: string;
  /** Their Bloxity profile picture, for the same reason. */
  avatarUrl: string;
  /** Wall clock of the last save, for diagnostics and future pruning. */
  updatedAt: number;
}

/**
 * Where profiles live.
 *
 * Nothing above this boundary knows whether that is a JSON file, a database or
 * nothing at all - `createPersistence` is the ONLY place that names a concrete
 * adapter.
 */
export interface PersistenceAdapter {
  /** Read everything into memory. Called once, before the server listens. */
  load(): Map<string, StoredProfile>;
  /** Queue a write. Implementations may debounce. */
  save(profiles: Map<string, StoredProfile>): void;
  /** Make any pending write durable. Called on shutdown. */
  flush(): void;
}
