import { injectHudStyles } from './hudStyles.js';

/**
 * How many panels are open.
 *
 * The input layer polls this to suppress movement while a panel owns the
 * screen. A COUNT rather than a boolean, so two panels closing in the wrong
 * order cannot leave the game permanently suppressed.
 */
let openCount = 0;

export const anyPanelOpen = (): boolean => openCount > 0;

/**
 * A modal panel: a titled box over a dimmed backdrop.
 *
 * Shared by the rebirth confirmation and the upgrade ladder, so the two cannot
 * drift apart visually and the open/close accounting exists once.
 */
export class Panel {
  protected readonly root: HTMLDivElement;
  protected readonly body: HTMLDivElement;

  private open = false;

  constructor(parent: HTMLElement, variant: string, title: string) {
    injectHudStyles();

    this.root = document.createElement('div');
    this.root.className = `mwe-panel mwe-panel--${variant}`;
    this.root.hidden = true;

    const box = document.createElement('div');
    box.className = 'mwe-panel__box';

    const head = document.createElement('div');
    head.className = 'mwe-panel__head mwe-font';
    const heading = document.createElement('span');
    heading.textContent = title;
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'mwe-panel__close mwe-font';
    close.textContent = '✕';
    close.addEventListener('click', () => this.setOpen(false));
    head.append(heading, close);

    this.body = document.createElement('div');
    this.body.className = 'mwe-panel__body';

    box.append(head, this.body);
    this.root.appendChild(box);

    // Clicking the dimmed backdrop closes; clicking the box itself must not.
    this.root.addEventListener('click', (event) => {
      if (event.target === this.root) this.setOpen(false);
    });
    box.addEventListener('click', (event) => event.stopPropagation());

    parent.appendChild(this.root);
  }

  get isOpen(): boolean {
    return this.open;
  }

  toggle(): void {
    this.setOpen(!this.open);
  }

  setOpen(open: boolean): void {
    if (open === this.open) return;
    this.open = open;
    this.root.hidden = !open;
    openCount += open ? 1 : -1;
    if (openCount < 0) openCount = 0;
    if (open) this.onOpened();
  }

  /** Hook for a subclass that needs to refresh its contents when shown. */
  protected onOpened(): void {
    /* nothing by default */
  }

  dispose(): void {
    if (this.open) this.setOpen(false);
    this.root.remove();
  }
}
