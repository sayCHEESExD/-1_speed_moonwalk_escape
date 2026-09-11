import { injectHudStyles } from './hudStyles.js';

/**
 * "THE MONSTER IS COMING", across the upper middle of the screen.
 *
 * ONE element, built once and toggled. It is driven every frame from the
 * monster's own `isChasing`, and a naive version of that would touch the DOM
 * sixty times a second for a string that changes twice a run - so the visible
 * state is cached and the class is only written when it actually FLIPS.
 *
 * It says exactly what the monster is doing and nothing else. There is no
 * timer on it, no fade-out after N seconds and no "danger" heuristic of its
 * own: it is up while the thing is chasing and down the instant it is not,
 * which is what makes it trustworthy rather than decorative. The player is
 * moonwalking - facing backwards, watching the thing come - so a banner that
 * lied about whether it was still coming would be worse than no banner.
 */
export class MonsterWarning {
  private readonly root: HTMLDivElement;

  /** What is currently on screen, so the DOM is written only on a change. */
  private visible = false;

  constructor(parent: HTMLElement) {
    injectHudStyles();

    this.root = document.createElement('div');
    this.root.className = 'mwe-monster mwe-font';
    this.root.textContent = 'THE MONSTER IS COMING';
    // Announced politely rather than assertively: it is atmosphere, and a
    // screen reader interrupting itself twice a run would be worse than the
    // information is worth.
    this.root.setAttribute('role', 'status');
    this.root.hidden = true;
    parent.appendChild(this.root);
  }

  /**
   * @param chasing the monster's own state. Nothing else may drive this.
   */
  setChasing(chasing: boolean): void {
    if (chasing === this.visible) return;
    this.visible = chasing;
    this.root.hidden = !chasing;
    // The entrance animation is restarted from scratch each time it comes up,
    // so a second chase in the same run lands as hard as the first.
    if (!chasing) return;
    this.root.classList.remove('mwe-monster--in');
    void this.root.offsetWidth;
    this.root.classList.add('mwe-monster--in');
  }

  dispose(): void {
    this.root.remove();
  }
}
