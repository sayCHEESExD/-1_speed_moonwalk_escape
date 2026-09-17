import type { Bloxity } from '../bloxity/Bloxity.js';
import { DEFAULT_PFP_URL } from '../bloxity/bloxityAssets.js';
import {
  PROPORTION_RANGES,
  type LegionFriend,
  type LegionProportions,
  type LegionUser,
} from '../bloxity/legionTypes.js';
import { logger } from '../util/logger.js';
import { Panel } from './Panel.js';
import { injectHudStyles } from './hudStyles.js';

const SCOPE = 'bloxity/ui';

/** A panel whose body can be filled from outside, keeping `Panel`'s open-count accounting. */
class ContentPanel extends Panel {
  readonly content = document.createElement('div');

  constructor(parent: HTMLElement, variant: string, title: string) {
    super(parent, variant, title);
    this.body.appendChild(this.content);
  }
}

/**
 * What Bux buys, by SKU. NO PRICES: Bloxity's catalogue prices each SKU,
 * keyed by the game slug. The Wins each SKU grants live on the SERVER
 * (`BuxGrants`), which is the only thing that grants them.
 */
const BUX_PRODUCTS: readonly { sku: string; name: string; blurb: string }[] = [
  { sku: 'wins_small', name: 'Pouch of Wins', blurb: 'A head start up the upgrade tiles.' },
  { sku: 'wins_large', name: 'Chest of Wins', blurb: 'Enough for a serious speed tier.' },
];

/** The proportions exposed as sliders. The customizer covers the rest. */
const SLIDERS: readonly { key: keyof LegionProportions; label: string }[] = [
  { key: 'height', label: 'Height' },
  { key: 'headScale', label: 'Head size' },
  { key: 'armLength', label: 'Arm length' },
  { key: 'shoulderWidth', label: 'Shoulders' },
];

/**
 * Bloxity's face inside the game: an account chip top-right, and Friends,
 * Avatar and Bux panels behind it.
 *
 * It owns no state. The chip redraws from `Bloxity.onUserChanged`, and every
 * figure is fetched when needed rather than cached, so a purchase in another
 * tab cannot leave a stale balance on screen.
 */
export class BloxityPanel {
  private readonly bloxity: Bloxity;
  private readonly chip: HTMLDivElement;
  private readonly friends: ContentPanel;
  private readonly avatar: ContentPanel;
  private readonly bux: ContentPanel;
  private readonly offUser: () => void;

  private roomId = '';
  /** Balance and friend count for the chip, refreshed on every login. */
  private balance: number | null = null;
  private friendCount: number | null = null;
  /** Transaction ids of purchases this session, for support and dedupe. */
  private readonly transactions: string[] = [];

  constructor(parent: HTMLElement, bloxity: Bloxity) {
    injectHudStyles();
    this.bloxity = bloxity;

    this.chip = document.createElement('div');
    this.chip.className = 'mwe-account mwe-font';
    parent.appendChild(this.chip);

    this.friends = new ContentPanel(parent, 'friends', 'Friends');
    this.avatar = new ContentPanel(parent, 'avatar', 'Avatar');
    this.bux = new ContentPanel(parent, 'bux', 'Bux Store');

    // The UI's one auth subscription, fanned out from the one in `Bloxity`.
    // Fires immediately, so the chip is never blank.
    this.offUser = this.bloxity.onUserChanged((user) => {
      this.balance = null;
      this.friendCount = null;
      this.renderChip(user);
      if (user) void this.loadAccountData();
    });
  }

  /** The room an invite should point at. */
  setRoom(roomId: string): void {
    this.roomId = roomId;
  }

  closeAll(): void {
    for (const panel of [this.friends, this.avatar, this.bux]) panel.setOpen(false);
  }

  /** Re-read the sliders when the portal changes proportions under us. */
  refreshAvatar(): void {
    if (this.avatar.isOpen) this.renderAvatar();
  }

  dispose(): void {
    this.offUser();
    this.chip.remove();
    this.friends.dispose();
    this.avatar.dispose();
    this.bux.dispose();
  }

  /** On login: friends and balance, so the chip can show them. The avatar arrives via the bridge. */
  private async loadAccountData(): Promise<void> {
    const [friends, balance] = await Promise.all([
      this.bloxity.getFriends(),
      this.bloxity.getBuxBalance(),
    ]);
    const user = this.bloxity.getUser();
    if (!user) return;
    this.friendCount = friends.length;
    this.balance = balance;
    this.renderChip(user);
  }

  // ------------------------------------------------------------------ chip

  private renderChip(user: LegionUser | null): void {
    this.chip.replaceChildren();

    if (!this.bloxity.available) {
      const note = document.createElement('span');
      note.className = 'mwe-account__note';
      note.textContent = 'Bloxity unavailable';
      this.chip.appendChild(note);
      return;
    }

    if (!user) {
      this.chip.appendChild(
        this.button('Log in', 'mwe-account__login', () => {
          void this.bloxity.showAuthPopup().then((result) => {
            logger.info(SCOPE, result ? `showAuthPopup returned @${result.username}` : 'showAuthPopup closed without a login');
          });
        }),
      );
      return;
    }

    const pfp = document.createElement('img');
    pfp.className = 'mwe-account__pfp';
    portrait(pfp, user.pfp);

    const name = document.createElement('span');
    name.className = 'mwe-account__name';
    name.textContent = user.displayName || user.username;

    const row = document.createElement('div');
    row.className = 'mwe-account__row';
    row.append(pfp, name);

    if (this.balance !== null) {
      const bux = document.createElement('span');
      bux.className = 'mwe-account__note';
      bux.textContent = `${this.balance.toLocaleString()} Bux`;
      row.appendChild(bux);
    }

    const actions = document.createElement('div');
    actions.className = 'mwe-account__actions';
    const friendsLabel = this.friendCount === null ? 'Friends' : `Friends (${this.friendCount})`;
    actions.append(
      this.button(friendsLabel, 'mwe-account__btn', () => void this.openFriends()),
      this.button('Avatar', 'mwe-account__btn', () => this.openAvatar()),
      this.button('Bux', 'mwe-account__btn', () => void this.openBux()),
      this.button('Log out', 'mwe-account__btn', () => this.bloxity.logout()),
    );

    this.chip.append(row, actions);
  }

  private button(label: string, className: string, onClick: () => void): HTMLButtonElement {
    const node = document.createElement('button');
    node.type = 'button';
    node.className = `${className} mwe-font`;
    node.textContent = label;
    node.addEventListener('click', (event) => {
      event.stopPropagation();
      onClick();
    });
    return node;
  }

  private only(panel: ContentPanel): void {
    for (const other of [this.friends, this.avatar, this.bux]) {
      if (other !== panel) other.setOpen(false);
    }
    panel.setOpen(true);
  }

  // --------------------------------------------------------------- friends

  private async openFriends(): Promise<void> {
    this.only(this.friends);
    this.friends.content.replaceChildren(this.note('Loading friends...'));

    const list = await this.bloxity.getFriends();
    if (!this.friends.isOpen) return;
    this.friendCount = list.length;

    const rows: HTMLElement[] =
      list.length === 0
        ? [this.note('No friends yet. Add some on bloxity.io.')]
        : list.map((friend) => this.friendRow(friend));

    // Works embedded and standalone; the SDK picks the right host.
    const link = this.bloxity.getInviteLink(this.roomId);
    if (link) {
      const copy = this.button('Copy invite link', 'mwe-action', () => {
        void navigator.clipboard
          .writeText(link)
          .then(() => {
            copy.textContent = 'Copied!';
            window.setTimeout(() => (copy.textContent = 'Copy invite link'), 1500);
          })
          .catch(() => logger.warn(SCOPE, 'clipboard refused the invite link'));
      });
      rows.push(copy);
    }
    this.friends.content.replaceChildren(...rows);
  }

  private friendRow(friend: LegionFriend): HTMLDivElement {
    const row = document.createElement('div');
    row.className = 'mwe-friend';

    const pfp = document.createElement('img');
    pfp.className = 'mwe-friend__pfp';
    portrait(pfp, friend.pfp);

    // Other people's names are text, never markup.
    const name = document.createElement('div');
    name.className = 'mwe-friend__name';
    // Their DISPLAY name, the same one their character carries in the world.
    // The `@handle` that used to sit under it was a second way to name the
    // same person, and this game shows people one way.
    const display = document.createElement('b');
    display.textContent = friend.displayName || friend.username;
    name.append(display);

    const status = document.createElement('span');
    status.className = 'mwe-friend__status';
    status.textContent = presenceLabel(friend);

    const invite = this.button('Invite', 'mwe-friend__invite', () => {
      invite.disabled = true;
      void this.bloxity.inviteFriend(friend._id, this.roomId).then((sent) => {
        invite.textContent = sent ? 'Invited' : 'Failed';
        if (!sent) invite.disabled = false;
      });
    });
    // An invite with no room would send them to the game rather than to you.
    if (!this.roomId) invite.disabled = true;

    row.append(pfp, name, status, invite);
    return row;
  }

  // ---------------------------------------------------------------- avatar

  private openAvatar(): void {
    this.only(this.avatar);
    this.renderAvatar();
  }

  private renderAvatar(): void {
    const proportions = this.bloxity.getProportions();

    const sliders = SLIDERS.map(({ key, label }) => {
      const [min, max] = PROPORTION_RANGES[key];
      const wrap = document.createElement('label');
      wrap.className = 'mwe-slider';
      const text = document.createElement('span');
      text.textContent = `${label}: ${proportions[key].toFixed(2)}`;
      const input = document.createElement('input');
      input.type = 'range';
      input.min = String(min);
      input.max = String(max);
      input.step = '0.01';
      input.value = String(proportions[key]);
      input.addEventListener('input', () => {
        text.textContent = `${label}: ${Number(input.value).toFixed(2)}`;
      });
      // Committed on release, not per pixel: each commit is persisted by the SDK.
      input.addEventListener('change', () => {
        void this.bloxity.setProportions({ [key]: Number(input.value) });
      });
      wrap.append(text, input);
      return wrap;
    });

    const customize = this.button('Open avatar customizer', 'mwe-action', () => {
      this.avatar.setOpen(false);
      this.bloxity.toggleCustomizer();
    });
    const reset = this.button('Reset proportions', 'mwe-action', () => {
      void this.bloxity.resetProportions().then(() => this.renderAvatar());
    });

    this.avatar.content.replaceChildren(
      this.note('Changes save to your Bloxity avatar and show on your character here.'),
      ...sliders,
      customize,
      reset,
    );
  }

  // ------------------------------------------------------------------- bux

  private async openBux(): Promise<void> {
    this.only(this.bux);
    this.bux.content.replaceChildren(this.note('Loading balance...'));

    const balance = await this.bloxity.getBuxBalance();
    if (!this.bux.isOpen) return;
    this.balance = balance;
    this.renderChip(this.bloxity.getUser());

    const header = this.note(
      balance === null ? 'Bux balance unavailable.' : `You have ${balance.toLocaleString()} Bux.`,
    );

    const rows = BUX_PRODUCTS.map((product) => {
      const row = document.createElement('div');
      row.className = 'mwe-bux';

      const text = document.createElement('div');
      text.className = 'mwe-bux__text';
      const title = document.createElement('b');
      title.textContent = product.name;
      const blurb = document.createElement('small');
      blurb.textContent = product.blurb;
      text.append(title, blurb);

      const buy = this.button('Buy', 'mwe-bux__buy', () => {
        buy.disabled = true;
        buy.textContent = 'Opening...';
        // ONLY the sku. Bloxity's catalogue decides the price.
        void this.bloxity.requestPurchase(product.sku, { roomId: this.roomId }).then((result) => {
          if (result.success) {
            if (result.transactionId) this.transactions.push(result.transactionId);
            logger.info(SCOPE, `purchased ${product.sku} (transaction ${result.transactionId ?? 'n/a'})`);
            // Wins are granted by this game's SERVER when Bloxity's webhook
            // lands, and arrive as replicated state - never granted here.
            header.textContent = 'Purchased! Your Wins arrive in a moment.';
            buy.textContent = 'Buy';
            buy.disabled = false;
            void this.bloxity.getBuxBalance().then((next) => {
              this.balance = next;
              this.renderChip(this.bloxity.getUser());
            });
          } else {
            buy.textContent = 'Buy';
            buy.disabled = false;
            header.textContent = result.error ?? 'Purchase cancelled.';
          }
        });
      });

      row.append(text, buy);
      return row;
    });

    this.bux.content.replaceChildren(header, ...rows);
  }

  private note(text: string): HTMLParagraphElement {
    const node = document.createElement('p');
    node.className = 'mwe-panel__note';
    node.textContent = text;
    return node;
  }
}

const presenceLabel = (friend: LegionFriend): string => {
  const status = friend.presence?.status ?? 'offline';
  const game = friend.presence?.gameName ?? friend.presence?.currentGame;
  if (status === 'in-game' || status === 'in_game') return game ? `In ${game}` : 'In game';
  if (status === 'online') return 'Online';
  if (status === 'away') return 'Away';
  return 'Offline';
};

/**
 * Point an `<img>` at somebody's Bloxity picture, with a fallback that cannot
 * itself fail.
 *
 * A profile URL is a third party's, so it can 404 or be pulled at any time,
 * and a broken-image icon beside a person's name reads as something being
 * wrong with the person. `onerror` swaps in the drawn placeholder instead.
 */
const portrait = (image: HTMLImageElement, url: string | undefined): void => {
  image.alt = '';
  image.draggable = false;
  image.onerror = () => {
    image.onerror = null;
    image.src = DEFAULT_PFP_URL;
  };
  image.src = url || DEFAULT_PFP_URL;
};
