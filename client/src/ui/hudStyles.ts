/**
 * One stylesheet for the whole HUD, injected on first use.
 *
 * Every panel and button in the game shares these rules, so the rail, the win
 * counter and the two shop panels cannot drift apart visually. The look is
 * taken from the reference art: heavy white display type with a thick dark
 * rim, saturated gradient tiles with a chunky border, and a red badge when
 * something is waiting to be collected.
 */
let injected = false;

export const injectHudStyles = (): void => {
  if (injected) return;
  injected = true;

  const style = document.createElement('style');
  style.textContent = `
:root {
  /* ONE number scales the whole left rail, so the column grows together. */
  --mwe-rail: 78px;
  --mwe-ink: #12181f;
}

.mwe-font {
  font-family: "Arial Black", "Arial Bold", Arial, system-ui, sans-serif;
}

/*
 * The chunky dark rim on every figure. Eight offsets plus a soft drop: a
 * -webkit-text-stroke would be one declaration, but it thins badly at small
 * sizes on some platforms and this reads identically everywhere.
 */
.mwe-outline {
  color: #fff;
  text-shadow:
    3px 0 0 var(--mwe-ink), -3px 0 0 var(--mwe-ink),
    0 3px 0 var(--mwe-ink), 0 -3px 0 var(--mwe-ink),
    2px 2px 0 var(--mwe-ink), -2px 2px 0 var(--mwe-ink),
    2px -2px 0 var(--mwe-ink), -2px -2px 0 var(--mwe-ink),
    0 5px 9px rgba(0, 0, 0, 0.45);
}

/* ---- Wins, upper centre ------------------------------------------------- */
.mwe-wins {
  position: fixed;
  top: max(10px, env(safe-area-inset-top, 0px));
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  align-items: center;
  gap: 10px;
  pointer-events: none;
  user-select: none;
  z-index: 22;
}
.mwe-wins__icon {
  width: clamp(32px, 3.6vw, 50px);
  height: clamp(32px, 3.6vw, 50px);
}
.mwe-wins__icon .mwe-icon {
  width: 100%;
  height: 100%;
  object-fit: contain;
  filter: drop-shadow(0 4px 6px rgba(0, 0, 0, 0.45));
}
.mwe-wins__value {
  font-size: clamp(22px, 3vw, 40px);
  line-height: 1;
  /* Orange, as the reference art has it - the one warm figure on screen. */
  color: #ff9d1f;
  text-shadow:
    3px 0 0 #fff, -3px 0 0 #fff, 0 3px 0 #fff, 0 -3px 0 #fff,
    2px 2px 0 #fff, -2px 2px 0 #fff, 2px -2px 0 #fff, -2px -2px 0 #fff,
    0 6px 10px rgba(0, 0, 0, 0.5);
}
.mwe-wins--pop .mwe-wins__value { animation: mwe-pop 520ms ease-out; }
@keyframes mwe-pop {
  0% { transform: scale(1); }
  35% { transform: scale(1.22); }
  100% { transform: scale(1); }
}

/* ---- Left rail ---------------------------------------------------------- */
.mwe-rail {
  position: fixed;
  left: max(10px, env(safe-area-inset-left, 0px));
  top: 50%;
  transform: translateY(-50%);
  display: flex;
  flex-direction: column;
  gap: 14px;
  z-index: 21;
  user-select: none;
}
.mwe-tile {
  position: relative;
  width: var(--mwe-rail);
  height: var(--mwe-rail);
  border: 4px solid var(--mwe-ink);
  border-radius: 20px;
  display: grid;
  place-items: center;
  cursor: pointer;
  padding: 0;
  box-shadow: 0 6px 12px rgba(0, 0, 0, 0.38);
  transition: transform 110ms ease;
}
.mwe-tile:hover { transform: scale(1.06); }
.mwe-tile:active { transform: scale(0.97); }
.mwe-tile .mwe-icon {
  width: 74%;
  height: 74%;
  object-fit: contain;
  /* The art carries its own outline, so it needs a drop shadow rather than a
   * stroke to lift it off the gradient behind it. */
  filter: drop-shadow(0 3px 3px rgba(0, 0, 0, 0.35));
  pointer-events: none;
}
/* The label sits UNDER the tile, overlapping its bottom edge, as in the art. */
.mwe-tile__label {
  position: absolute;
  left: 50%;
  bottom: -9px;
  transform: translateX(-50%);
  font-size: clamp(11px, 1.15vw, 15px);
  white-space: nowrap;
  pointer-events: none;
}
/* The PC key cap, top-left, as in the reference art.
 *
 * Top LEFT because the red "!" badge already owns the bottom right and the
 * label owns the bottom edge - the corner is the only place it can sit without
 * covering something that was there first.
 */
.mwe-tile__key {
  position: absolute;
  left: -7px;
  top: -7px;
  min-width: 22px;
  height: 22px;
  padding: 0 4px;
  box-sizing: border-box;
  border: 3px solid var(--mwe-ink);
  border-radius: 7px;
  background: #ffffff;
  color: var(--mwe-ink);
  font-size: 13px;
  line-height: 16px;
  text-align: center;
  box-shadow: 0 2px 0 rgba(0, 0, 0, 0.28);
  pointer-events: none;
}
/* Touch has no keyboard, so the mobile layout keeps exactly what it had. */
body.mwe-touch-mode .mwe-tile__key { display: none; }

/* The red "!" badge: something is available. */
.mwe-tile__badge {
  position: absolute;
  right: -8px;
  bottom: -8px;
  width: 24px;
  height: 24px;
  border: 3px solid var(--mwe-ink);
  border-radius: 50%;
  background: #f5363f;
  color: #fff;
  font-size: 15px;
  line-height: 18px;
  text-align: center;
  display: none;
}
.mwe-tile--ready .mwe-tile__badge { display: block; }
.mwe-tile--locked { filter: saturate(0.45) brightness(0.78); }

.mwe-tile--rebirth {
  background: linear-gradient(160deg, #ff5ff0 0%, #b23bff 55%, #7a1fd6 100%);
}
.mwe-tile--upgrade {
  background: linear-gradient(160deg, #6de6ff 0%, #2aa8f5 55%, #1670d0 100%);
}
.mwe-tile--audio {
  background: linear-gradient(160deg, #ffd76b 0%, #ffa32b 55%, #d97708 100%);
}
/* Muted: the tile stays lit enough to find, and plainly off. */
.mwe-tile--off { filter: saturate(0.25) brightness(0.7); }
.mwe-tile--off .mwe-icon { opacity: 0.55; }

/* ---- Trophies flying to the Wins counter --------------------------------
 * Above the HUD, unlike the Speed popups: these are meant to arrive AT the
 * counter, so passing behind it would hide the moment they exist for. They
 * last about half a second and nothing can be clicked through them.
 */
.mwe-flight {
  position: fixed;
  inset: 0;
  pointer-events: none;
  overflow: hidden;
  z-index: 30;
}
.mwe-flight__cup {
  position: absolute;
  left: 0;
  top: 0;
  width: clamp(26px, 3vw, 40px);
  height: auto;
  opacity: 0;
  will-change: transform, opacity;
  filter: drop-shadow(0 3px 5px rgba(0, 0, 0, 0.45));
}
.mwe-flight__cup[hidden] { display: none; }
.mwe-flight__cup--run { animation: mwe-flight 620ms cubic-bezier(0.4, 0, 0.5, 1) forwards; }
@keyframes mwe-flight {
  0% {
    opacity: 0;
    transform: translate(calc(var(--mwe-fx) - 50%), calc(var(--mwe-fy) - 50%)) scale(0.4) rotate(0deg);
  }
  18% {
    opacity: 1;
    transform: translate(calc(var(--mwe-fx) - 50%), calc(var(--mwe-fy) - 50%)) scale(1.1) rotate(-20deg);
  }
  60% {
    opacity: 1;
    transform: translate(calc(var(--mwe-mx) - 50%), calc(var(--mwe-my) - 50%)) scale(0.95) rotate(140deg);
  }
  100% {
    opacity: 0;
    transform: translate(calc(var(--mwe-tx) - 50%), calc(var(--mwe-ty) - 50%)) scale(0.35) rotate(340deg);
  }
}
@media (prefers-reduced-motion: reduce) {
  /* Still travels - that is the information - but without the tumble. */
  .mwe-flight__cup--run { animation: mwe-flight-plain 620ms ease-out forwards; }
  @keyframes mwe-flight-plain {
    0% { opacity: 0; transform: translate(calc(var(--mwe-fx) - 50%), calc(var(--mwe-fy) - 50%)); }
    20%, 70% { opacity: 1; }
    100% { opacity: 0; transform: translate(calc(var(--mwe-tx) - 50%), calc(var(--mwe-ty) - 50%)); }
  }
}

/* ---- The Rebirth panel ---------------------------------------------------
 * A BEFORE and AFTER pair with an arrow between them, as the reference art
 * frames it: the two things a rebirth changes, side by side, so the trade is
 * legible at a glance instead of buried in a paragraph.
 */
.mwe-rb {
  display: grid;
  grid-template-columns: 1fr auto 1fr;
  align-items: center;
  gap: 10px 12px;
  margin-bottom: 14px;
}
.mwe-rb__head {
  text-align: center;
  font-size: clamp(15px, 1.6vw, 20px);
  color: #43506b;
}
.mwe-rb__card {
  display: grid;
  place-items: center;
  padding: 10px 8px;
  border-radius: 12px;
  border: 3px solid var(--mwe-ink);
  box-shadow: inset 0 -4px 0 rgba(0, 0, 0, 0.18);
  font-size: clamp(14px, 1.7vw, 22px);
  color: #ffffff;
  /* The figure is the point of the card, so it never wraps and never clips:
   * it shrinks to fit instead, the same rule the world signs follow. */
  white-space: nowrap;
  overflow: hidden;
  text-shadow:
    2px 0 0 var(--mwe-ink), -2px 0 0 var(--mwe-ink),
    0 2px 0 var(--mwe-ink), 0 -2px 0 var(--mwe-ink);
}
.mwe-rb__card--speed {
  background: linear-gradient(180deg, #8fd0ff 0%, #4b9ff0 55%, #2f7ad4 100%);
}
.mwe-rb__card--level {
  background: linear-gradient(180deg, #ffd76b 0%, #ffa32b 55%, #e07f10 100%);
}
.mwe-rb__arrow {
  width: 0;
  height: 0;
  justify-self: center;
  border-top: 15px solid transparent;
  border-bottom: 15px solid transparent;
  border-left: 22px solid #c6d8ef;
  filter: drop-shadow(2px 2px 0 rgba(43, 60, 88, 0.35));
}
/* The reference panel sits on a pale blue ground rather than plain white,
 * which is what keeps the white card text legible. */
.mwe-panel--rebirth .mwe-panel__body {
  background: #dce7f5;
}
.mwe-rb__warn {
  margin: 0 0 12px;
  text-align: center;
  font-size: clamp(14px, 1.5vw, 19px);
  color: #f4506a;
  text-shadow: 1px 1px 0 rgba(255, 255, 255, 0.75);
}
.mwe-rb__bar {
  position: relative;
  height: 34px;
  border-radius: 10px;
  border: 3px solid var(--mwe-ink);
  background: #ffffff;
  overflow: hidden;
  margin-bottom: 14px;
}
.mwe-rb__fill {
  height: 100%;
  background: linear-gradient(180deg, #9bf06a 0%, #4fce2e 60%, #37a81f 100%);
  transition: width 220ms ease-out;
}
.mwe-rb__barlabel {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  font-size: clamp(13px, 1.4vw, 17px);
  color: #ffffff;
  text-shadow:
    2px 0 0 var(--mwe-ink), -2px 0 0 var(--mwe-ink),
    0 2px 0 var(--mwe-ink), 0 -2px 0 var(--mwe-ink);
}
.mwe-rb__go {
  background: linear-gradient(180deg, #ff8cf0 0%, #b44bff 55%, #7f22d6 100%);
  color: #ffffff;
  font-size: clamp(17px, 2vw, 26px);
}
.mwe-rb__go:disabled {
  filter: saturate(0.3) brightness(0.85);
}
@media (prefers-reduced-motion: reduce) {
  .mwe-rb__fill { transition: none; }
}

/* ---- The Bloxity account chip -------------------------------------------
 * Top RIGHT: the Wins counter owns the top centre and the rail owns the left,
 * and this is the only corner left that a player is not already reading.
 */
.mwe-account {
  position: fixed;
  top: 12px;
  right: 12px;
  z-index: 23;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 6px;
}
.mwe-account__row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 10px 4px 4px;
  border: 3px solid var(--mwe-ink);
  border-radius: 999px;
  background: rgba(18, 24, 38, 0.82);
}
.mwe-account__pfp {
  width: 30px;
  height: 30px;
  border-radius: 50%;
  border: 2px solid var(--mwe-ink);
  object-fit: cover;
}
.mwe-account__name {
  font-size: clamp(12px, 1.2vw, 15px);
  color: #ffffff;
  max-width: 22vw;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.mwe-account__note {
  font-size: clamp(10px, 1vw, 13px);
  color: #ffffff;
  opacity: 0.6;
}
.mwe-account__actions {
  display: flex;
  gap: 6px;
}
.mwe-account__btn,
.mwe-account__login {
  cursor: pointer;
  border: 3px solid var(--mwe-ink);
  border-radius: 10px;
  padding: 5px 10px;
  font-size: clamp(11px, 1.1vw, 14px);
  color: #ffffff;
  background: linear-gradient(180deg, #6de6ff 0%, #2aa8f5 55%, #1670d0 100%);
  box-shadow: 0 3px 0 rgba(0, 0, 0, 0.3);
}
.mwe-account__login {
  background: linear-gradient(180deg, #ffd76b 0%, #ffa32b 55%, #d97708 100%);
  padding: 7px 14px;
}
.mwe-account__btn:hover,
.mwe-account__login:hover { filter: brightness(1.1); }
/* Touch keeps the chip but drops the row of buttons to a single tap target's
 * worth of width, so it never crowds the jump button. */
body.mwe-touch-mode .mwe-account__name { max-width: 30vw; }

/* ---- Friends and Bux rows ----------------------------------------------- */
.mwe-friend {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 7px 4px;
  border-bottom: 2px solid rgba(43, 60, 88, 0.16);
}
.mwe-friend:last-of-type { border-bottom: none; }
.mwe-friend__pfp {
  width: 34px;
  height: 34px;
  border-radius: 50%;
  border: 2px solid var(--mwe-ink);
  object-fit: cover;
  flex: none;
}
.mwe-friend__name {
  display: flex;
  flex-direction: column;
  line-height: 1.2;
  flex: 1 1 auto;
  min-width: 0;
}
.mwe-friend__name b,
.mwe-friend__name small {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.mwe-friend__name small { opacity: 0.6; }
.mwe-friend__status {
  font-size: 12px;
  opacity: 0.75;
  flex: none;
}
.mwe-friend__invite,
.mwe-bux__buy {
  cursor: pointer;
  flex: none;
  border: 3px solid var(--mwe-ink);
  border-radius: 9px;
  padding: 5px 11px;
  color: #ffffff;
  font: inherit;
  font-size: 13px;
  background: linear-gradient(180deg, #9bf06a 0%, #4fce2e 60%, #37a81f 100%);
}
.mwe-friend__invite:disabled,
.mwe-bux__buy:disabled { filter: saturate(0.3) brightness(0.85); cursor: default; }

.mwe-bux {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 9px 4px;
  border-bottom: 2px solid rgba(43, 60, 88, 0.16);
}
.mwe-bux:last-of-type { border-bottom: none; }
.mwe-bux__text {
  display: flex;
  flex-direction: column;
  line-height: 1.25;
  flex: 1 1 auto;
}
.mwe-bux__text small { opacity: 0.65; }
.mwe-bux__buy {
  background: linear-gradient(180deg, #ffd76b 0%, #ffa32b 55%, #d97708 100%);
}

.mwe-panel--friends .mwe-panel__head,
.mwe-panel--bux .mwe-panel__head {
  background: linear-gradient(160deg, #6de6ff 0%, #2aa8f5 55%, #1670d0 100%);
}

/* ---- The FPS readout, from the portal's show_fps setting ----------------- */
.mwe-fps {
  position: fixed;
  left: 12px;
  top: 12px;
  z-index: 23;
  font-size: 13px;
  color: #9bf06a;
  text-shadow:
    2px 0 0 var(--mwe-ink), -2px 0 0 var(--mwe-ink),
    0 2px 0 var(--mwe-ink), 0 -2px 0 var(--mwe-ink);
  pointer-events: none;
}
.mwe-fps[hidden] { display: none; }

/* ---- Panels ------------------------------------------------------------- */
.mwe-panel {
  position: fixed;
  inset: 0;
  display: grid;
  place-items: center;
  background: rgba(6, 10, 18, 0.55);
  z-index: 40;
}
.mwe-panel[hidden] { display: none; }
.mwe-panel__box {
  width: min(560px, 92vw);
  max-height: 82vh;
  display: flex;
  flex-direction: column;
  border: 5px solid var(--mwe-ink);
  border-radius: 22px;
  background: #f2f5f8;
  box-shadow: 0 18px 40px rgba(0, 0, 0, 0.5);
  overflow: hidden;
}
.mwe-panel__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  color: #fff;
  font-size: 22px;
}
.mwe-panel--rebirth .mwe-panel__head {
  background: linear-gradient(90deg, #b23bff, #7a1fd6);
}
.mwe-panel--upgrade .mwe-panel__head {
  background: linear-gradient(90deg, #2aa8f5, #1670d0);
}
.mwe-panel__close {
  border: 3px solid var(--mwe-ink);
  border-radius: 12px;
  background: #f5363f;
  color: #fff;
  width: 34px;
  height: 34px;
  font-size: 17px;
  cursor: pointer;
}
.mwe-panel__body {
  padding: 14px 16px 18px;
  overflow-y: auto;
  color: #16202b;
  font-family: system-ui, "Segoe UI", Roboto, sans-serif;
  font-size: 14px;
}
.mwe-panel__note { margin-bottom: 12px; line-height: 1.5; }
.mwe-panel__note b { font-size: 16px; }

.mwe-action {
  width: 100%;
  padding: 13px;
  border: 4px solid var(--mwe-ink);
  border-radius: 16px;
  background: linear-gradient(180deg, #58e06a, #2fae42);
  color: #fff;
  font-size: 19px;
  cursor: pointer;
}
.mwe-action:disabled {
  background: linear-gradient(180deg, #b9c2cc, #93a0ad);
  cursor: not-allowed;
}

/* ---- Shop rows ---------------------------------------------------------- */
.mwe-row {
  display: flex;
  align-items: center;
  gap: 11px;
  padding: 9px 11px;
  margin-bottom: 8px;
  border: 3px solid var(--mwe-ink);
  border-radius: 14px;
  background: #fff;
}
.mwe-row--owned { background: #eafbe9; }
.mwe-row--equipped { background: #dff3ff; box-shadow: inset 0 0 0 3px #2aa8f5; }
.mwe-row__swatch {
  width: 30px;
  height: 30px;
  border: 3px solid var(--mwe-ink);
  border-radius: 9px;
  flex: none;
}
.mwe-row__text { flex: 1; min-width: 0; }
.mwe-row__name { font-weight: 800; }
.mwe-row__meta { opacity: 0.72; font-size: 12px; }
.mwe-row__buy {
  border: 3px solid var(--mwe-ink);
  border-radius: 12px;
  padding: 8px 13px;
  background: linear-gradient(180deg, #ffd54a, #f0a91f);
  font-weight: 800;
  cursor: pointer;
  white-space: nowrap;
}
.mwe-row__buy:disabled {
  background: linear-gradient(180deg, #cfd6dd, #aab4bf);
  cursor: not-allowed;
}

/* ---- Nameplates --------------------------------------------------------- */
/*
 * The name chips over every player's head, positioned by Nameplates after
 * each render. The script writes only a transform and a z-index; everything
 * else is here.
 *
 * BELOW every piece of HUD in the stacking order, so a crowd of players can
 * never cover a figure the player needs to read.
 */
.mwe-plates {
  position: fixed;
  inset: 0;
  pointer-events: none;
  overflow: hidden;
  z-index: 18;
}
.mwe-plate {
  position: absolute;
  left: 0;
  top: 0;
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 2px 9px 2px 2px;
  border-radius: 999px;
  background: rgba(12, 8, 24, 0.62);
  border: 1px solid rgba(255, 255, 255, 0.14);
  /* Scaled toward the head it hangs over, not away from it. */
  transform-origin: 50% 100%;
  white-space: nowrap;
  will-change: transform;
}
.mwe-plate[hidden] { display: none; }
.mwe-plate--bare { padding: 3px 10px; }
.mwe-plate__pfp {
  width: 22px;
  height: 22px;
  border-radius: 50%;
  object-fit: cover;
  background: rgba(255, 255, 255, 0.16);
  flex: none;
}
.mwe-plate__pfp[hidden] { display: none; }
.mwe-plate__name {
  font-family: system-ui, "Segoe UI", Roboto, sans-serif;
  font-weight: 700;
  font-size: 13px;
  line-height: 1.25;
  color: #ffffff;
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.85);
  max-width: 160px;
  overflow: hidden;
  text-overflow: ellipsis;
}
@media (max-width: 720px) {
  .mwe-plate__pfp { width: 18px; height: 18px; }
  .mwe-plate__name { font-size: 12px; max-width: 120px; }
}

/* ---- Speed-gain popups -------------------------------------------------- */
/*
 * Deliberately BELOW the HUD in the stacking order (the bar is 20, the rail 21,
 * the Wins counter 22). Popups are spawned inside a band that already misses
 * all three, and sitting under them means even a mis-tuned band can never
 * cover a figure the player needs to read.
 */
.mwe-pops {
  position: fixed;
  inset: 0;
  pointer-events: none;
  overflow: hidden;
  z-index: 19;
}
.mwe-pop {
  --mwe-pop-tilt: 0deg;
  --mwe-pop-scale: 1;
  position: absolute;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 1px;
  opacity: 0;
  will-change: transform, opacity;
}
.mwe-pop[hidden] { display: none; }
.mwe-pop__icon {
  /* shoe.png is supplied art. Driving the HEIGHT and leaving the width automatic is
   * what keeps that ratio exact at every clamp step. */
  height: clamp(36px, 4.2vw, 60px);
  width: auto;
  filter: drop-shadow(0 3px 5px rgba(0, 0, 0, 0.45));
}
.mwe-pop__value {
  font-size: clamp(16px, 2vw, 29px);
  line-height: 1;
  color: #fff;
  text-shadow:
    3px 0 0 var(--mwe-ink), -3px 0 0 var(--mwe-ink),
    0 3px 0 var(--mwe-ink), 0 -3px 0 var(--mwe-ink),
    2px 2px 0 var(--mwe-ink), -2px 2px 0 var(--mwe-ink),
    2px -2px 0 var(--mwe-ink), -2px -2px 0 var(--mwe-ink),
    0 4px 8px rgba(0, 0, 0, 0.5);
}
.mwe-pop--run { animation: mwe-pop-float 1150ms ease-out forwards; }
@keyframes mwe-pop-float {
  0% {
    opacity: 0;
    transform: translate(-50%, -50%) rotate(var(--mwe-pop-tilt))
      scale(calc(var(--mwe-pop-scale) * 0.6));
  }
  16% {
    opacity: 1;
    transform: translate(-50%, -54%) rotate(var(--mwe-pop-tilt))
      scale(calc(var(--mwe-pop-scale) * 1.1));
  }
  30% {
    opacity: 1;
    transform: translate(-50%, -62%) rotate(var(--mwe-pop-tilt))
      scale(var(--mwe-pop-scale));
  }
  100% {
    opacity: 0;
    transform: translate(-50%, -125%) rotate(var(--mwe-pop-tilt))
      scale(var(--mwe-pop-scale));
  }
}

/* Touch controls own the bottom corners; the rail lifts clear of them. */
body.mwe-touch-mode .mwe-rail { --mwe-rail: 62px; }

@media (prefers-reduced-motion: reduce) {
  .mwe-tile, .mwe-wins--pop .mwe-wins__value { transition: none; animation: none; }
  /* The popup still has to appear and go away, so it fades in place rather
   * than not animating at all. */
  .mwe-pop--run { animation: mwe-pop-fade 1150ms ease-out forwards; }
  @keyframes mwe-pop-fade {
    0% { opacity: 0; transform: translate(-50%, -50%); }
    15%, 65% { opacity: 1; transform: translate(-50%, -50%); }
    100% { opacity: 0; transform: translate(-50%, -50%); }
  }
}

/* A narrow window has less room either side, so the band tightens with it. */
@media (max-width: 760px) {
  .mwe-pop__icon { height: clamp(30px, 6vw, 44px); }
  .mwe-pop__value { font-size: clamp(14px, 3vw, 22px); }
}

/*
 * The upgrade ladder panel.
 *
 * A reference sheet, not a shop - there are no buy buttons in it, because
 * buying happens by standing on a tile. Rows are colour-coded to the tile they
 * stand for, so the panel and the arena floor can be matched at a glance.
 */
.mwe-shop__hint {
  margin: 0 0 12px;
  font-size: 13px;
  color: #ffd24d;
  text-align: center;
  letter-spacing: 0.02em;
}
.mwe-shop {
  display: flex;
  flex-direction: column;
  gap: 6px;
  max-height: min(52vh, 420px);
  overflow-y: auto;
}
.mwe-shop__row {
  display: grid;
  grid-template-columns: 14px 1fr auto auto;
  align-items: center;
  gap: 10px;
  padding: 8px 12px;
  border: 3px solid var(--mwe-ink);
  border-radius: 12px;
  background: linear-gradient(180deg, #232a44 0%, #171c30 100%);
  /* Locked rows are dimmed but never hidden: a player has to be able to see
     what they are working toward. */
  filter: saturate(0.5) brightness(0.8);
}
.mwe-shop__row--ready {
  filter: none;
  box-shadow: 0 0 0 2px rgba(255, 226, 77, 0.55);
}
.mwe-shop__row--owned {
  filter: none;
  background: linear-gradient(180deg, #1d4030 0%, #12261d 100%);
}
.mwe-shop__swatch {
  width: 14px;
  height: 14px;
  border-radius: 4px;
  border: 2px solid var(--mwe-ink);
}
.mwe-shop__name { font-size: 15px; color: #ffffff; }
.mwe-shop__gain { font-size: 14px; color: #7fe0ff; white-space: nowrap; }
.mwe-shop__status {
  font-size: 12px;
  color: #ffe14d;
  white-space: nowrap;
  min-width: 74px;
  text-align: right;
}
.mwe-shop__row--owned .mwe-shop__status { color: #8affc0; }

/* Bloxity avatar panel: the head matches the other account panels. */
.mwe-panel--avatar .mwe-panel__head {
  background: linear-gradient(90deg, #ff2d78, #a855f7);
}
.mwe-slider {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-bottom: 12px;
  font-size: 13px;
}
.mwe-slider input { width: 100%; accent-color: #ff2d78; }
.mwe-panel--avatar .mwe-action,
.mwe-panel--friends .mwe-action { margin-top: 8px; }

/*
 * "THE MONSTER IS COMING".
 *
 * Upper middle, so it sits in the band between the Wins counter and the
 * Speed-gain popups and covers neither. It takes no pointer events because it
 * is over the play area: a warning you could accidentally click would eat the
 * click that was meant to re-take the pointer lock.
 *
 * (No backticks in this file's CSS - the whole stylesheet is a template
 * literal, and one would end it.)
 */
.mwe-monster {
  position: fixed;
  top: 22%;
  left: 50%;
  transform: translateX(-50%);
  z-index: 25;
  pointer-events: none;
  user-select: none;
  white-space: nowrap;
  font-size: clamp(22px, 4.4vw, 58px);
  letter-spacing: 0.06em;
  color: #ff3d6e;
  /* The chunky dark rim every figure in this game carries, plus a red bloom so
     it reads against the neon rather than disappearing into it. */
  text-shadow:
    3px 0 0 #2b0410, -3px 0 0 #2b0410, 0 3px 0 #2b0410, 0 -3px 0 #2b0410,
    2px 2px 0 #2b0410, -2px 2px 0 #2b0410, 2px -2px 0 #2b0410, -2px -2px 0 #2b0410,
    0 0 18px rgba(255, 45, 120, 0.85), 0 6px 14px rgba(0, 0, 0, 0.55);
  animation: mwe-monster-pulse 1.1s ease-in-out infinite;
}
.mwe-monster--in { animation: mwe-monster-arrive 260ms ease-out, mwe-monster-pulse 1.1s ease-in-out 260ms infinite; }

@keyframes mwe-monster-pulse {
  0%, 100% { opacity: 0.88; transform: translateX(-50%) scale(1); }
  50% { opacity: 1; transform: translateX(-50%) scale(1.035); }
}
@keyframes mwe-monster-arrive {
  0% { opacity: 0; transform: translateX(-50%) scale(0.82); }
  100% { opacity: 1; transform: translateX(-50%) scale(1); }
}

/* Touch controls own the bottom; the warning stays clear of the top HUD. */
@media (max-width: 760px) {
  .mwe-monster { top: 19%; }
}

@media (prefers-reduced-motion: reduce) {
  .mwe-monster,
  .mwe-monster--in { animation: none; opacity: 1; }
}
`;
  document.head.appendChild(style);
};

/**
 * The HUD icons, as supplied in `assets/ui/`.
 *
 * Served straight from the repo-level assets folder through Vite's publicDir,
 * exactly as the player model is - so there is no duplicate copy inside the
 * client workspace. They are the artwork from the reference screenshots, which
 * is why they are images rather than the hand-drawn SVGs they replaced: a
 * traced approximation of a piece of art you already have is a worse version
 * of it.
 *
 * `alt` is deliberately empty - each one sits inside a control that already
 * carries its own accessible name.
 */
const icon = (file: string): string =>
  `<img class="mwe-icon" src="/ui/${file}" alt="" draggable="false">`;

/*
 * The speaker is drawn rather than loaded.
 *
 * The other three are SUPPLIED ART and are used as they are; there is no
 * supplied speaker, and adding an image for a shape that is four straight
 * lines would be the one place in this project where a file bought nothing.
 */
const SPEAKER =
  '<svg class="mwe-icon" viewBox="0 0 24 24" aria-hidden="true">' +
  '<path fill="currentColor" d="M4 9h3.2L12 4.6v14.8L7.2 15H4z"/>' +
  '<path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" ' +
  'd="M15.6 8.6a4.6 4.6 0 0 1 0 6.8M18.4 5.8a8.4 8.4 0 0 1 0 12.4"/>' +
  '</svg>';

export const ICONS = {
  trophy: icon('trophy.png'),
  rebirth: icon('rebirth.png'),
  /**
   * The upgrade ladder's icon.
   *
   * `shoe.png` is SUPPLIED ART and is used exactly as it is - never
   * regenerated procedurally, and never given both a width and a height in
   * CSS, so its real aspect ratio survives.
   */
  upgrade: icon('shoe.png'),
  audio: SPEAKER,
} as const;
