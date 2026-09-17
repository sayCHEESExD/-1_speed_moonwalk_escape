import {
  BUNDLED_LOOK,
  isEquippedId,
  sanitiseAvatarLook,
  type AvatarLook,
} from '@moonwalk/shared';
import { logger } from '../util/logger.js';
import {
  DEFAULT_PROPORTIONS,
  type LegionEquipped,
  type LegionFriend,
  type LegionProportions,
  type LegionPurchaseResult,
  type LegionSdk,
  type LegionUser,
} from './legionTypes.js';

const SCOPE = 'bloxity';

/**
 * The slug this game is registered under on bloxity.io.
 *
 * The same id the deploy workflow publishes to. `VITE_BLOXITY_GAME_ID` can
 * override it at build time; the literal is what a local `npm run dev` uses.
 */
export const GAME_SLUG =
  (import.meta.env['VITE_BLOXITY_GAME_ID'] as string | undefined)?.trim() ||
  'speed-moonwalk-escape';

/**
 * Every portal setting this game answers to.
 *
 * Registering a listener is what makes the control appear in the portal menu,
 * so each key here is genuinely wired. `enable_chat` and
 * `background_transparency` are drawn by the portal itself; the game only has
 * to declare them.
 */
export const SETTING_KEYS = [
  'master_volume',
  'music_volume',
  'graphics_quality',
  'show_fps',
  'camera_sensitivity',
  'enable_chat',
  'fullscreen',
  'background_transparency',
] as const;

type SettingKey = (typeof SETTING_KEYS)[number];

/** What the game hands the bridge, so the bridge never reaches into the game. */
export interface BloxityHost {
  /** 0..1 */
  setMasterVolume(level: number): void;
  /** 0..1 */
  setMusicVolume(level: number): void;
  setGraphicsQuality(level: string): void;
  setShowFps(show: boolean): void;
  setCameraSensitivity(scale: number): void;
  /** The portal menu asked for a respawn. */
  respawn(): void;
  pointerLockChanged(locked: boolean): void;
  /**
   * The player's appearance changed - a different hat, a slider, or a
   * different ACCOUNT. One record, because the local character, the server and
   * every other client in the room all have to be dressing from the same one.
   */
  lookChanged(look: AvatarLook): void;
  /** Login or logout. `token` is for this game's server, never for display. */
  identityChanged(user: LegionUser | null, token: string | null): void;
}

/**
 * The SDK, or null. EVERY call goes through here, because the script is from a
 * third-party CDN and a game that threw without it would be taken offline by a
 * blocked script.
 */
const sdk = (): LegionSdk | null => window.Legion?.SDK ?? null;

const guard = <T>(what: string, body: (api: LegionSdk) => T): T | undefined => {
  const api = sdk();
  if (!api) return undefined;
  try {
    return body(api);
  } catch (error) {
    logger.warn(SCOPE, `${what} failed: ${String(error)}`);
    return undefined;
  }
};

const fraction = (value: string, fallback: number): number => {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? Math.min(Math.max(parsed / 100, 0), 1) : fallback;
};

const number = (value: string, fallback: number): number => {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

/**
 * This game's whole relationship with Bloxity.
 *
 * ONE module, and ONE `auth.onUserChanged` subscription inside it, which is the
 * single source of truth for who is signed in. Nothing else touches
 * `window.Legion`. The user object is never cached: `getUser()` is asked each
 * time it is needed.
 */
export class Bloxity {
  private readonly host: BloxityHost;
  private readonly unsubscribes: (() => void)[] = [];
  private readonly userListeners = new Set<(user: LegionUser | null) => void>();
  private started = false;
  private didInit = false;

  constructor(host: BloxityHost) {
    this.host = host;
  }

  /** Whether `init` actually ran - not merely whether the script is present. */
  get initialised(): boolean {
    return this.didInit;
  }

  get available(): boolean {
    return sdk() !== null;
  }

  get embedded(): boolean {
    return guard('portal.isEmbeddedInLegion', (api) => api.portal?.isEmbeddedInLegion?.() ?? false) ?? false;
  }

  /**
   * Initialise ONCE, before any namespace is used. The slug is passed even when
   * embedded, because standalone hosting and Bux purchases resolve through it.
   */
  start(): void {
    if (this.started) return;
    this.started = true;

    const api = sdk();
    if (!api) {
      logger.warn(SCOPE, 'SDK not present - running without Bloxity. The game itself is unaffected.');
      this.emitUser(null);
      return;
    }

    guard('init', () => api.init({ gameSlug: GAME_SLUG }));
    this.didInit = true;
    logger.info(SCOPE, `SDK initialised as "${GAME_SLUG}" (${this.embedded ? 'embedded' : 'standalone'})`);

    this.watchUser();
    this.watchAvatar();
    this.watchSettings();
    this.watchPlayerEvents();
  }

  // ------------------------------------------------------------------ auth

  getUser(): LegionUser | null {
    return guard('auth.getUser', (api) => api.auth?.getUser?.() ?? null) ?? null;
  }

  getToken(): string | null {
    return guard('auth.getToken', (api) => api.auth?.getToken?.() ?? null) ?? null;
  }

  isLoggedIn(): boolean {
    return guard('auth.isLoggedIn', (api) => api.auth?.isLoggedIn?.() ?? false) ?? false;
  }

  async showAuthPopup(): Promise<LegionUser | null> {
    return (await guard('auth.showAuthPopup', (api) => api.auth?.showAuthPopup?.())) ?? null;
  }

  logout(): void {
    guard('auth.logout', (api) => api.auth?.logout?.());
  }

  /**
   * Subscribe to the auth state. Fans out from the ONE SDK subscription and
   * fires immediately with the current state, exactly as the SDK's own does.
   */
  onUserChanged(callback: (user: LegionUser | null) => void): () => void {
    this.userListeners.add(callback);
    callback(this.getUser());
    return () => this.userListeners.delete(callback);
  }

  // ---------------------------------------------------------------- avatar

  getEquipped(): LegionEquipped {
    return guard('avatar.getEquipped', (api) => api.avatar?.getEquipped?.()) ?? {};
  }

  /**
   * The player's whole appearance, in the form that travels.
   *
   * `bloxity` is true whenever the SDK could actually describe this player -
   * which is NOT the same as "they equipped something". A player who has never
   * opened the customiser still has a Bloxity default avatar, and that default
   * is Bloxity's body and Bloxity's default skin; the bundled character is
   * what is left when the SDK is blocked, offline or absent, and nothing else.
   */
  getLook(): AvatarLook {
    const equipped = guard('avatar.getEquipped', (api) => api.avatar?.getEquipped?.());
    if (!equipped) return BUNDLED_LOOK;
    const id = (value: string | null | undefined): string => (isEquippedId(value) ? value : '');
    return sanitiseAvatarLook({
      bloxity: true,
      items: {
        hat: id(equipped.hatId),
        back: id(equipped.backId),
        skin: id(equipped.skinId),
        head: id(equipped.headId),
        torso: id(equipped.torsoId),
        armL: id(equipped.armLId),
        armR: id(equipped.armRId),
        legL: id(equipped.legLId),
        legR: id(equipped.legRId),
      },
      proportions: this.getProportions(),
    });
  }

  getProportions(): LegionProportions {
    const raw = guard('avatar.getProportions', (api) => api.avatar?.getProportions?.());
    return { ...DEFAULT_PROPORTIONS, ...(raw ?? {}) };
  }

  async setProportions(partial: Partial<LegionProportions>): Promise<void> {
    await guard('avatar.setProportions', (api) => api.avatar?.setProportions?.(partial));
  }

  async resetProportions(): Promise<void> {
    await guard('avatar.resetProportions', (api) => api.avatar?.resetProportions?.());
  }

  toggleCustomizer(): void {
    guard('avatar.toggleCustomizer', (api) => api.avatar?.toggleCustomizer?.());
  }

  isCustomizerOpen(): boolean {
    return guard('avatar.isCustomizerOpen', (api) => api.avatar?.isCustomizerOpen?.() ?? false) ?? false;
  }

  // ---------------------------------------------------------------- social

  async getFriends(): Promise<LegionFriend[]> {
    return (await guard('social.getFriends', (api) => api.social?.getFriends?.())) ?? [];
  }

  /** The room is published FIRST, so the friend lands in this room rather than just the game. */
  async inviteFriend(userId: string, roomId: string): Promise<boolean> {
    if (roomId) this.updateRoom(roomId);
    return (await guard('social.inviteFriend', (api) => api.social?.inviteFriend?.(userId))) ?? false;
  }

  getInviteLink(roomId: string): string {
    return (
      guard('social.getInviteFriendsLink', (api) =>
        api.social?.getInviteFriendsLink?.(roomId ? { gameSlug: GAME_SLUG, roomId } : { gameSlug: GAME_SLUG }),
      ) ?? ''
    );
  }

  async sendFriendRequest(userId: string): Promise<{ success: boolean; status?: string; error?: string }> {
    return (
      (await guard('social.sendFriendRequest', (api) => api.social?.sendFriendRequest?.(userId))) ?? {
        success: false,
        error: 'Friends are unavailable right now.',
      }
    );
  }

  // ------------------------------------------------------------- lifecycle

  loadingStep(text: string): void {
    guard('game.loadingStep', (api) => api.game?.loadingStep?.(text));
  }

  loadingEnd(): void {
    guard('game.loadingEnd', (api) => api.game?.loadingEnd?.());
  }

  gameplayStart(): void {
    guard('game.gameplayStart', (api) => api.game?.gameplayStart?.());
  }

  gameplayEnd(): void {
    guard('game.gameplayEnd', (api) => api.game?.gameplayEnd?.());
  }

  /** The Colyseus room id when joinable, '' otherwise. */
  updateRoom(roomId: string, partyId?: string): void {
    guard('game.updateRoom', (api) => api.game?.updateRoom?.(roomId, partyId));
  }

  playerJoined(username: string): void {
    guard('game.playerJoined', (api) => api.game?.playerJoined?.(username));
  }

  playerInRoom(username: string): void {
    guard('game.playerInRoom', (api) => api.game?.playerInRoom?.(username));
  }

  /** Hand ESC to the portal's pause menu. */
  showPortalMenu(lockCursorOnResume = true): void {
    guard('portal.showMenu', (api) => api.portal?.showMenu?.(lockCursorOnResume));
  }

  // -------------------------------------------------------------------- bux

  /**
   * The SKU and nothing else. The PRICE lives in Bloxity's catalogue keyed by
   * the slug, and the GRANT comes from this game's server via the webhook.
   */
  async requestPurchase(sku: string, metadata?: Record<string, unknown>): Promise<LegionPurchaseResult> {
    return (
      (await guard('bux.requestPurchase', (api) => api.bux?.requestPurchase?.(sku, metadata))) ?? {
        success: false,
        error: 'Bux are unavailable right now.',
      }
    );
  }

  async getBuxBalance(): Promise<number | null> {
    const balance = await guard('bux.getBalance', (api) => api.bux?.getBalance?.());
    return typeof balance === 'number' ? balance : null;
  }

  dispose(): void {
    for (const off of this.unsubscribes) {
      try {
        off();
      } catch {
        /* one failing unsubscribe must not stop the others */
      }
    }
    this.unsubscribes.length = 0;
    this.userListeners.clear();
  }

  // --------------------------------------------------------- subscriptions

  private keep(off: unknown): void {
    if (typeof off === 'function') this.unsubscribes.push(off as () => void);
  }

  private emitUser(user: LegionUser | null): void {
    for (const listener of this.userListeners) {
      try {
        listener(user);
      } catch (error) {
        logger.warn(SCOPE, `user listener failed: ${String(error)}`);
      }
    }
  }

  /** THE auth subscription. There is exactly one, and this is it. */
  private watchUser(): void {
    this.keep(
      guard('auth.onUserChanged', (api) =>
        api.auth?.onUserChanged?.((user) => {
          logger.info(SCOPE, user ? `onUserChanged: signed in as @${user.username}` : 'onUserChanged: signed out');
          this.emitUser(user);
          this.host.identityChanged(user, user ? this.getToken() : null);
          // Cosmetics belong to the account, so a new account is a new look.
          this.pushAvatar();
        }),
      ),
    );
  }

  private watchAvatar(): void {
    this.keep(guard('avatar.onAvatarChanged', (api) => api.avatar?.onAvatarChanged?.(() => this.pushAvatar())));
    this.keep(
      guard('avatar.onProportionsChanged', (api) => api.avatar?.onProportionsChanged?.(() => this.pushAvatar())),
    );
  }

  private pushAvatar(): void {
    this.host.lookChanged(this.getLook());
  }

  /** `listen` fires immediately, so registering IS applying; `triggerAll` covers builds that deliver on demand. */
  private watchSettings(): void {
    for (const key of SETTING_KEYS) {
      this.keep(
        guard(`settings.listen(${key})`, (api) =>
          api.settings?.listen?.(key, (value) => this.applySetting(key, String(value ?? ''))),
        ),
      );
    }
    guard('settings.triggerAll', (api) => api.settings?.triggerAll?.());
  }

  private applySetting(key: SettingKey, value: string): void {
    switch (key) {
      case 'master_volume':
        this.host.setMasterVolume(fraction(value, 0.8));
        break;
      case 'music_volume':
        this.host.setMusicVolume(fraction(value, 0.8));
        break;
      case 'graphics_quality':
        this.host.setGraphicsQuality(value || 'High');
        break;
      case 'show_fps':
        this.host.setShowFps(value === 'true');
        break;
      case 'camera_sensitivity':
        this.host.setCameraSensitivity(Math.min(Math.max(number(value, 1), 0.1), 5));
        break;
      case 'fullscreen':
        guard('portal.fullscreen', (api) => {
          if (value === 'true') api.portal?.requestFullscreen?.();
          else api.portal?.exitFullscreen?.();
        });
        break;
      case 'enable_chat':
      case 'background_transparency':
        // Drawn by the portal; declared so the control appears.
        break;
    }
  }

  private watchPlayerEvents(): void {
    this.keep(
      guard('player.onEvent', (api) =>
        api.player?.onEvent?.((event, data) => {
          switch (event) {
            case 'respawn_request':
              this.host.respawn();
              break;
            case 'pointer_lock_changed':
              this.host.pointerLockChanged(data === true);
              break;
            case 'chat_message_sent':
              // The portal draws chat; this game has none of its own.
              logger.info(SCOPE, `chat: ${String(data)}`);
              break;
          }
        }),
      ),
    );
  }
}
