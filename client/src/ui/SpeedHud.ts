import {
  formatSpeed,
  rebirthMultiplier,
  resolveLevel,
  type LevelProgress,
} from '@moonwalk/shared';

/**
 * The Speed and Level HUD.
 *
 * This is the WHOLE user interface for the first version, and deliberately so:
 * the big Speed figure over the mount, the rebirth multiplier beside it, and
 * the level bar under both. No shop panel, no inventory, no settings.
 *
 * Everything it shows is SERVER-AUTHORITATIVE state. It renders the replicated
 * lifetime Speed total and the level that follows from it through the shared
 * formula - it never awards, predicts or derives progress of its own.
 *
 * Laid out to match the reference art: heavy white display type with a thick
 * dark rim, a rounded track with a rainbow progress fill, the level name at
 * the left of the fill and the "into / required" figures at the right.
 *
 * Built as three independent rows so a fourth can be added later - a Wins
 * counter, the buy buttons - without re-laying out what is already here.
 */
export class SpeedHud {
  private readonly root: HTMLDivElement;
  private readonly speedLabel: HTMLDivElement;
  private readonly multiLabel: HTMLDivElement;
  private readonly fill: HTMLDivElement;
  private readonly levelLabel: HTMLDivElement;
  private readonly amountLabel: HTMLDivElement;

  private lastTotal = -1;
  private lastLevel = -1;
  private lastRebirths = -1;

  constructor(parent: HTMLElement) {
    injectStyles();

    this.root = el('div', 'mwe-hud');

    const speedRow = el('div', 'mwe-hud__speed-row');
    this.speedLabel = el('div', 'mwe-hud__speed');
    this.speedLabel.textContent = '0 Speed';
    this.multiLabel = el('div', 'mwe-hud__multi');
    this.multiLabel.textContent = 'x1 Multi (Rebirth)';
    speedRow.append(this.speedLabel, this.multiLabel);

    const bar = el('div', 'mwe-hud__bar');
    this.fill = el('div', 'mwe-hud__fill');
    this.levelLabel = el('div', 'mwe-hud__level');
    this.levelLabel.textContent = 'Level 1';
    this.amountLabel = el('div', 'mwe-hud__amount');
    this.amountLabel.textContent = '0/0';
    bar.append(this.fill, this.levelLabel, this.amountLabel);

    this.root.append(speedRow, bar);
    parent.appendChild(this.root);
  }

  /**
   * @param totalSpeed lifetime Speed farmed, replicated from the server
   * @param levelCap   highest reachable level for this player
   * @param rebirths   replicated rebirth count
   */
  update(totalSpeed: number, levelCap: number, rebirths: number): void {
    if (totalSpeed !== this.lastTotal) {
      this.lastTotal = totalSpeed;
      this.speedLabel.textContent = `${formatSpeed(totalSpeed)} Speed`;
      this.renderBar(resolveLevel(totalSpeed, levelCap));
    }

    const level = resolveLevel(totalSpeed, levelCap).level;
    if (level !== this.lastLevel) {
      this.lastLevel = level;
      this.levelLabel.textContent = `Level ${level}`;
      // A brief pop marks the moment a level - and a permanent speed rise - is
      // gained. Restarting the animation needs the reflow in between.
      this.root.classList.remove('mwe-hud--levelup');
      void this.root.offsetWidth;
      this.root.classList.add('mwe-hud--levelup');
    }

    if (rebirths !== this.lastRebirths) {
      this.lastRebirths = rebirths;
      this.multiLabel.textContent = `x${rebirthMultiplier(rebirths)} Multi (Rebirth)`;
    }
  }

  dispose(): void {
    this.root.remove();
  }

  private renderBar(progress: LevelProgress): void {
    this.fill.style.width = `${(progress.fraction * 100).toFixed(2)}%`;
    this.amountLabel.textContent = progress.capped
      ? 'MAX LEVEL'
      : `${formatSpeed(progress.into)}/${formatSpeed(progress.required)}`;
  }
}

const el = <K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag);
  node.className = className;
  return node;
};

let stylesInjected = false;

/** One stylesheet for the HUD, injected on first construction. */
const injectStyles = (): void => {
  if (stylesInjected) return;
  stylesInjected = true;

  const style = document.createElement('style');
  style.textContent = `
.mwe-hud {
  position: fixed;
  left: 50%;
  bottom: 3.5vh;
  transform: translateX(-50%);
  width: min(720px, 74vw);
  pointer-events: none;
  user-select: none;
  /*
   * A heavy grotesque with a real black weight. The reference art uses a
   * rounded display face; Arial Black is the closest thing every platform
   * already has, and shipping a font file would be the single largest asset in
   * a build that currently has none.
   */
  font-family: "Arial Black", "Arial Bold", Arial, system-ui, sans-serif;
  z-index: 20;
}

/*
 * The chunky dark rim on every figure. Eight offsets plus a soft drop: a
 * -webkit-text-stroke would be one declaration, but it thins badly at small
 * sizes on some platforms and this reads identically everywhere.
 */
.mwe-hud__speed,
.mwe-hud__level,
.mwe-hud__amount {
  color: #ffffff;
  text-shadow:
    3px 0 0 #12181f, -3px 0 0 #12181f, 0 3px 0 #12181f, 0 -3px 0 #12181f,
    2px 2px 0 #12181f, -2px 2px 0 #12181f, 2px -2px 0 #12181f, -2px -2px 0 #12181f,
    0 5px 9px rgba(0, 0, 0, 0.45);
}

.mwe-hud__speed-row {
  position: relative;
  display: flex;
  align-items: flex-end;
  justify-content: center;
  gap: 10px;
  margin-bottom: 8px;
}
.mwe-hud__speed {
  font-size: clamp(24px, 3.5vw, 46px);
  letter-spacing: 0.01em;
  line-height: 1.05;
  white-space: nowrap;
}
/* The rebirth multiplier: purple, smaller, and sitting off the baseline of the
 * Speed figure rather than centred with it. */
.mwe-hud__multi {
  font-size: clamp(11px, 1.35vw, 18px);
  color: #d46bff;
  white-space: nowrap;
  padding-bottom: 0.35em;
  text-shadow:
    2px 0 0 #2a1038, -2px 0 0 #2a1038, 0 2px 0 #2a1038, 0 -2px 0 #2a1038,
    0 3px 6px rgba(0, 0, 0, 0.4);
}

.mwe-hud__bar {
  position: relative;
  height: clamp(34px, 4.6vw, 58px);
  border-radius: 999px;
  border: 4px solid #12181f;
  box-shadow: 0 5px 12px rgba(0, 0, 0, 0.4);
  overflow: hidden;
  /*
   * The empty track is a studded white plate, matching the brick surfaces in
   * the world. Two crossed gradients draw the stud grid without an image.
   */
  background-color: #f4f6f8;
  background-image:
    linear-gradient(90deg, rgba(0, 0, 0, 0.07) 1px, transparent 1px),
    linear-gradient(0deg, rgba(0, 0, 0, 0.07) 1px, transparent 1px);
  background-size: 14px 14px;
}
/*
 * The progress fill is the rainbow, and the level name sits ON it - so the bar
 * reads as one object filling up rather than as a chip beside a gauge.
 */
.mwe-hud__fill {
  position: absolute;
  inset: 0 auto 0 0;
  width: 0%;
  border-radius: 999px 6px 6px 999px;
  background: linear-gradient(
    90deg,
    #b46bff 0%,
    #5b8cff 22%,
    #37d17a 44%,
    #ffe14d 66%,
    #ff9c3d 84%,
    #ff5a4d 100%
  );
  box-shadow: inset 0 -4px 0 rgba(0, 0, 0, 0.16);
  transition: width 130ms linear;
}
.mwe-hud__level,
.mwe-hud__amount {
  position: absolute;
  top: 0;
  bottom: 0;
  display: flex;
  align-items: center;
  font-size: clamp(15px, 1.95vw, 25px);
  white-space: nowrap;
}
.mwe-hud__level { left: 18px; }
.mwe-hud__amount { right: 18px; }

.mwe-hud--levelup .mwe-hud__bar {
  animation: mwe-hud-pop 460ms ease-out;
}
@keyframes mwe-hud-pop {
  0% { transform: scale(1); box-shadow: 0 0 0 0 rgba(255, 226, 120, 0.9); }
  35% { transform: scale(1.03); box-shadow: 0 0 0 9px rgba(255, 226, 120, 0); }
  100% { transform: scale(1); box-shadow: 0 5px 12px rgba(0, 0, 0, 0.4); }
}

/* Touch controls own the bottom corners, so the HUD lifts clear of them. */
body.mwe-touch-mode .mwe-hud {
  bottom: calc(3.5vh + 96px);
  width: min(560px, 62vw);
}

@media (prefers-reduced-motion: reduce) {
  .mwe-hud__fill { transition: none; }
  .mwe-hud--levelup .mwe-hud__bar { animation: none; }
}
`;
  document.head.appendChild(style);
};
