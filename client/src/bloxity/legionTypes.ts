import type { AvatarProportions } from '@moonwalk/shared';

/**
 * The Bloxity SDK's shape, as this game uses it.
 *
 * The SDK ships as a plain script that installs `window.Legion`, with no types
 * of its own. These declarations are the CONTRACT this game codes against, and
 * every namespace is optional because the script comes from a third-party CDN
 * and may simply not be there - offline, blocked, or an older build.
 */

export interface LegionUser {
  readonly _id: string;
  readonly username: string;
  readonly displayName?: string;
  readonly email?: string;
  readonly pfp?: string;
  readonly avatar?: string;
}

/**
 * A friend's presence.
 *
 * The in-game status is spelled both ways in the wild - the docs say `in-game`
 * and the reference page emits `in_game` - so anything reading it accepts both.
 */
export interface LegionPresence {
  readonly status: 'online' | 'in-game' | 'in_game' | 'away' | 'offline';
  readonly currentGame?: string;
  readonly currentRoom?: string;
  readonly currentParty?: string;
  readonly gameSlug?: string;
  readonly gameName?: string;
  readonly lastSeen?: string;
}

export interface LegionFriend {
  readonly _id: string;
  readonly username: string;
  readonly displayName?: string;
  readonly pfp?: string;
  readonly presence?: LegionPresence;
}

/** Equipped cosmetic ids. `'-1'`, `''`, `'undefined'` and null all mean NONE. */
export interface LegionEquipped {
  readonly hatId?: string | null;
  readonly backId?: string | null;
  readonly skinId?: string | null;
  readonly headId?: string | null;
  readonly armLId?: string | null;
  readonly armRId?: string | null;
  readonly legLId?: string | null;
  readonly legRId?: string | null;
  readonly torsoId?: string | null;
}

/**
 * Avatar proportions. Every value is a multiplier defaulting to 1.
 *
 * The type, its defaults and its clamps live in `shared/` and are re-exported
 * here: the server replicates a look to every other player and clamps what it
 * is told, so the ranges are something the two halves AGREE on rather than
 * something the client knows on its own.
 */
export type LegionProportions = AvatarProportions;
export { DEFAULT_PROPORTIONS, PROPORTION_RANGES } from '@moonwalk/shared';

export interface LegionPurchaseResult {
  readonly success: boolean;
  readonly transactionId?: string;
  readonly error?: string;
}

export interface LegionFriendRequestResult {
  readonly success: boolean;
  readonly status?: 'accepted' | 'pending';
  readonly error?: string;
}

export interface LegionSdk {
  init(options: { gameSlug: string }): void;

  auth?: {
    getUser(): LegionUser | null;
    getToken(): string | null;
    isLoggedIn(): boolean;
    showAuthPopup(): Promise<LegionUser | null>;
    logout(): void;
    onUserChanged(callback: (user: LegionUser | null) => void): () => void;
    authenticateWithServer(url: string): Promise<unknown | null>;
  };

  avatar?: {
    getEquipped(): LegionEquipped;
    getHatId(): string;
    getBackId(): string;
    getSkinId(): string;
    getHeadId(): string;
    getArmLId(): string;
    getArmRId(): string;
    getLegLId(): string;
    getLegRId(): string;
    getTorsoId(): string;
    getProportions(): LegionProportions;
    setProportions(partial: Partial<LegionProportions>): Promise<unknown>;
    resetProportions(): Promise<unknown>;
    onAvatarChanged(callback: (equipped: LegionEquipped) => void): () => void;
    onProportionsChanged(callback: (proportions: LegionProportions) => void): () => void;
    showCustomizer(): void;
    hideCustomizer(): void;
    toggleCustomizer(): void;
    isCustomizerOpen(): boolean;
  };

  social?: {
    getFriends(): Promise<LegionFriend[]>;
    inviteFriend(userId: string): Promise<boolean>;
    getInviteFriendsLink(options?: {
      gameSlug?: string;
      roomId?: string;
      partyId?: string;
      baseUrl?: string;
      ref?: string;
    }): string;
    sendFriendRequest(userId: string): Promise<LegionFriendRequestResult>;
  };

  settings?: {
    listen(key: string, callback: (value: string) => void): () => void;
    get(key: string): string;
    getAll(): Record<string, string>;
    onChanged(callback: (settings: Record<string, string>) => void): () => void;
    triggerAll(): void;
    refresh(): void;
  };

  game?: {
    loadingStep(text: string): void;
    loadingEnd(): void;
    gameplayStart(): void;
    gameplayEnd(): void;
    updateRoom(roomId: string, partyId?: string): void;
    playerJoined(username: string): void;
    playerInRoom(username: string): void;
  };

  player?: {
    /** Confirmed against the live SDK: the callback receives `(event, data)`. */
    onEvent(callback: (event: string, data?: unknown) => void): () => void;
  };

  bux?: {
    requestPurchase(
      sku: string,
      metadata?: Record<string, unknown>,
    ): Promise<LegionPurchaseResult>;
    getBalance(): Promise<number>;
  };

  portal?: {
    isInIframe(): boolean;
    isEmbeddedInLegion(): boolean;
    requestFullscreen(): void;
    exitFullscreen(): void;
    showMenu(lockCursorOnResume?: boolean): void;
  };

  api?: {
    get(path: string): Promise<unknown>;
    post(path: string, body?: unknown): Promise<unknown>;
    patch(path: string, body?: unknown): Promise<unknown>;
    delete(path: string): Promise<unknown>;
  };
}

declare global {
  interface Window {
    Legion?: { SDK?: LegionSdk };
  }
}

/**
 * An id is only equipped if it is a real one - exactly the reference page's
 * test, and shared with the server, which applies it to every look it is sent.
 */
export { isEquippedId } from '@moonwalk/shared';
