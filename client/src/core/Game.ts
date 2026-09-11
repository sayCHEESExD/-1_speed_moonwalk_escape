import { stageAt, type RespawnMessage, type StageAwardedMessage } from '@moonwalk/shared';
import { Vector3 } from 'three';
import { AudioManager } from '../audio/AudioManager.js';
import { PlayerAudio } from '../audio/PlayerAudio.js';
import { ThirdPersonCamera } from '../camera/ThirdPersonCamera.js';
import { clientConfig } from '../config/clientConfig.js';
import { Guard } from '../guard/Guard.js';
import { InputManager } from '../input/InputManager.js';
import { NetworkClient } from '../net/NetworkClient.js';
import type { ConnectionStatus, NetPlayerState } from '../net/netTypes.js';
import { LocalPlayer } from '../player/LocalPlayer.js';
import { playerModelLoader, type PlayerModelReport } from '../player/PlayerModelLoader.js';
import { RemotePlayerManager } from '../player/RemotePlayerManager.js';
import { RunController } from '../progression/RunController.js';
import { RendererManager } from '../rendering/RendererManager.js';
import { SceneManager } from '../rendering/SceneManager.js';
import { MonsterWarning } from '../ui/MonsterWarning.js';
import { Panel, anyPanelOpen } from '../ui/Panel.js';
import { RailButton } from '../ui/RailButton.js';
import { RebirthPanel } from '../ui/RebirthPanel.js';
import { SpeedHud } from '../ui/SpeedHud.js';
import { SpeedPopups } from '../ui/SpeedPopups.js';
import { UpgradePanel } from '../ui/UpgradePanel.js';
import { WinFlight } from '../ui/WinFlight.js';
import { WinsCounter } from '../ui/WinsCounter.js';
import { ICONS, injectHudStyles } from '../ui/hudStyles.js';
import { logger } from '../util/logger.js';
import { CourseWorld } from '../world/CourseWorld.js';

const SCOPE = 'Game';

/**
 * Which shortcut a key event means, or '' for none.
 *
 * Reads `code` FIRST and falls back to `key`, and that fallback is the whole
 * point of this function. `code` is the physical key and is the right thing to
 * bind to, but it is not always populated: on-screen keyboards, remote-input
 * and automation paths, and some IME states all deliver a perfectly ordinary
 * keystroke with `code` set to the empty string. Matching on `code` alone means
 * those keystrokes silently do nothing - the shortcuts look implemented and are
 * not.
 */
const shortcutOf = (event: KeyboardEvent): string => {
  const code = event.code;
  if (code.startsWith('Key') && code.length === 4) return code.slice(3).toLowerCase();
  if (code) return code.toLowerCase();
  return (event.key || '').toLowerCase();
};

/**
 * True if the keystroke belongs to a field the player is typing in.
 *
 * Covers every element that takes text, not just `<input>`: a shortcut that
 * fired while someone typed in a textarea would be just as wrong.
 */
const isTyping = (target: EventTarget | null): boolean => {
  const element = target as HTMLElement | null;
  if (!element) return false;
  if (element.isContentEditable) return true;
  const tag = element.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
};

/** Scratch for projecting the player to the screen. One award allocates nothing. */
const WIN_FLIGHT_ORIGIN = new Vector3();

/**
 * Composition root.
 *
 * Owns every subsystem and defines the per-frame update order, and holds no
 * gameplay rules of its own. The order below is the only thing here that
 * matters, and it is deliberate: input, then prediction, then triggers, then
 * the guard, then the camera, then the network, then the render.
 *
 * The GUARD sits after the triggers on purpose. It chases the position the
 * player actually reached this frame, so a catch is decided against the same
 * transform the hazard test used - and a player who died to a disco ball on
 * the same frame the guard arrived is killed by the ball, which is the one the
 * server can confirm.
 */
export class Game {
  private readonly renderer: RendererManager;
  private readonly sceneManager = new SceneManager();
  private readonly camera = new ThirdPersonCamera();
  private readonly input = new InputManager();
  private readonly remotePlayers: RemotePlayerManager;
  private readonly hud: SpeedHud;
  private readonly pops: SpeedPopups;
  private readonly wins: WinsCounter;
  private readonly winFlight: WinFlight;
  private readonly monsterWarning: MonsterWarning;
  private readonly rail: HTMLDivElement;
  private readonly rebirthButton: RailButton;
  private readonly upgradeButton: RailButton;
  private readonly audioButton: RailButton;
  private readonly audio = new AudioManager();
  private readonly playerAudio: PlayerAudio;
  private readonly rebirthPanel: RebirthPanel;
  private readonly upgradePanel: UpgradePanel;
  private readonly network: NetworkClient;
  private readonly world = new CourseWorld();
  private readonly run: RunController;

  /**
   * THE guard, and there is exactly one because there is exactly one local
   * player. It is never added to `remotePlayers`, never replicated and never
   * shown to anybody else.
   */
  private readonly guard: Guard;

  private localPlayer: LocalPlayer | null = null;
  private localSessionId: string | null = null;

  /** Replicated figures the audio reacts to, so it reacts to CHANGES. */
  private lastLevel = -1;
  private lastRebirths = -1;
  private lastOwnedTiers = -1;
  private modelReport: PlayerModelReport | null = null;

  /**
   * The client's estimate of the server's clock.
   *
   * Advanced by the frame delta and re-based whenever a fresher `elapsed`
   * arrives. Freezing it between patches would make every disco ball stutter
   * at the patch rate rather than move smoothly.
   */
  private worldTime = 0;
  private lastServerTime = -1;

  /** Authoritative respawn waiting for the death animation to finish. */
  private pendingRespawn: RespawnMessage | null = null;

  constructor(container: HTMLElement) {
    injectHudStyles();
    this.renderer = new RendererManager(container);
    this.remotePlayers = new RemotePlayerManager(this.sceneManager.scene);
    this.hud = new SpeedHud(container);
    this.pops = new SpeedPopups(container);
    this.wins = new WinsCounter(container);
    this.winFlight = new WinFlight(container);
    this.monsterWarning = new MonsterWarning(container);

    this.guard = new Guard(this.world.collision);
    this.sceneManager.scene.add(this.guard.root);

    // The left rail. Three tiles, laid out so a fourth can be added without
    // re-spacing the others.
    this.rail = document.createElement('div');
    this.rail.className = 'mwe-rail';
    container.appendChild(this.rail);

    this.rebirthPanel = new RebirthPanel(container, () => this.network.requestRebirth());
    this.upgradePanel = new UpgradePanel(container);

    this.rebirthButton = new RailButton(this.rail, {
      variant: 'rebirth',
      label: 'Rebirth',
      icon: ICONS.rebirth,
      hotkey: 'R',
      onClick: () => this.openOnly(this.rebirthPanel),
    });
    this.upgradeButton = new RailButton(this.rail, {
      variant: 'upgrade',
      label: 'Speed',
      icon: ICONS.upgrade,
      hotkey: 'U',
      onClick: () => this.openOnly(this.upgradePanel),
    });
    this.audioButton = new RailButton(this.rail, {
      variant: 'audio',
      label: 'Sound',
      icon: ICONS.audio,
      hotkey: 'M',
      onClick: () => {
        // The ONE place muting happens, whether it was a click or the M key.
        const muted = this.audio.toggleMuted();
        this.audioButton.root.classList.toggle('mwe-tile--off', muted);
      },
    });

    this.playerAudio = new PlayerAudio(this.audio);

    window.addEventListener('keydown', this.onHotkey);
    // Audio can only start on a real gesture, and no single one of them is
    // guaranteed to be the one the browser accepts - so every gesture asks,
    // and `resume` is written to be safe to call repeatedly.
    window.addEventListener('keydown', this.onGesture);
    window.addEventListener('mousedown', this.onGesture);
    window.addEventListener('touchstart', this.onGesture, { passive: true });

    this.renderer.onResize((width, height) => this.camera.setViewport(width, height));

    this.network = new NetworkClient({
      onStatusChange: (status) => this.onStatusChange(status),
      onSelfJoined: (sessionId) => {
        this.localSessionId = sessionId;
      },
      onPlayerAdded: (sessionId, player) => this.onPlayerAdded(sessionId, player),
      onPlayerChanged: (sessionId, player) => this.onPlayerChanged(sessionId, player),
      onPlayerRemoved: (sessionId) => this.remotePlayers.remove(sessionId),
      onRespawn: (message) => {
        // The server's authoritative respawn. HELD rather than applied at once:
        // the client is usually mid-animation, and the whole point of the death
        // transition is that nothing moves the character until it ends.
        this.pendingRespawn = message;
        this.localPlayer?.acknowledgeRespawn();
        this.applyPendingRespawn();
      },
      onStageAwarded: (message) => this.onStageAwarded(message),
    });

    this.run = new RunController(this.world.collision, {
      claimStage: (index) => {
        // Flush the pending input first: the server validates the claim against
        // the last position it has SIMULATED, so the movement that carried the
        // player past the line must be consumed before the request arrives.
        this.flushInput();
        this.network.claimStage(index);
      },
      buyUpgrade: (slot) => {
        this.flushInput();
        this.network.buyUpgrade(slot);
      },
    });
  }

  /**
   * Keys that open the menus.
   *
   * Every panel has one, because a panel that can only be reached by clicking
   * a button the cursor cannot reach is not reachable. Ignored while the player
   * is typing, and ignored with a modifier held, so browser shortcuts still
   * work.
   */
  private readonly onHotkey = (event: KeyboardEvent): void => {
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.repeat) return;
    if (isTyping(event.target)) return;

    /*
     * A key PRESSES THE BUTTON. It does not do the same thing as the button.
     *
     * `RailButton.press()` dispatches the tile's own click, so the key path and
     * the mouse path run one handler between them - and a key can never drift
     * into doing almost-but-not-quite what the tile it stands for does.
     */
    switch (shortcutOf(event)) {
      case 'r':
        this.rebirthButton.press();
        break;
      case 'u':
        this.upgradeButton.press();
        break;
      case 'm':
        this.audioButton.press();
        break;
      case 'escape':
        // The browser releases the lock on Escape whatever the page wants, so
        // this only closes whatever was open - `MouseLook` handles the cursor.
        for (const panel of [this.rebirthPanel, this.upgradePanel]) panel.setOpen(false);
        this.input.look.setCursorFree(true);
        break;
      default:
        break;
    }
  };

  /** Any real gesture is permission to start audio. */
  private readonly onGesture = (): void => {
    this.audio.resume();
  };

  /**
   * Open one panel and close the other.
   *
   * Two modals over each other is a state with no way back to the game, and
   * the rail makes it one click away.
   */
  private openOnly(panel: Panel): void {
    for (const other of [this.rebirthPanel, this.upgradePanel]) {
      if (other !== panel) other.setOpen(false);
    }
    panel.toggle();
  }

  /** Load assets and build the world. Networking is started separately. */
  async initialise(): Promise<PlayerModelReport> {
    this.world.addTo(this.sceneManager.scene);
    this.sceneManager.setSky(this.world.skyTexture);

    this.modelReport = await playerModelLoader.load();

    this.localPlayer = new LocalPlayer(this.world.collision);
    this.sceneManager.scene.add(this.localPlayer.character.root);
    this.camera.snapTo(this.localPlayer.position);
    this.guard.placeBehind(this.localPlayer.position, this.localPlayer.rotationY);

    logger.info(SCOPE, 'world ready');
    return this.modelReport;
  }

  /** Join the Colyseus room. Rendering continues even if this fails. */
  async connect(): Promise<void> {
    await this.network.connect();
  }

  start(): void {
    this.input.attach(this.renderer.renderer.domElement);
  }

  stop(): void {
    this.input.detach();
    void this.network.disconnect();
  }

  /** One simulation and render step. Called by GameLoop. */
  update(delta: number, _now: number): void {
    // A panel owns the input while it is up; closing it hands control straight
    // back on the next frame.
    this.input.setSuppressed(anyPanelOpen());
    const input = this.input.sample();
    const player = this.localPlayer;

    // The MOUSE aims the camera, and the camera defines forward. Nothing the
    // player presses rotates the view.
    this.camera.setOrbit(this.input.look.yaw, this.input.look.pitch);

    // The world clock, advanced locally between patches. Every disco ball is a
    // pure function of it on BOTH sides, so the client has to keep its own
    // estimate rather than freezing between server updates.
    this.worldTime =
      this.network.elapsed > this.lastServerTime
        ? this.network.elapsed
        : this.worldTime + delta;
    this.lastServerTime = this.network.elapsed;
    const elapsed = this.worldTime;

    if (player) {
      player.setWorldTime(elapsed);
      // Camera-relative movement: forward is whichever way the camera faces.
      // The character's own facing then follows where it actually moves - and
      // the model is drawn half a turn from that, which is the moonwalk.
      player.update(delta, input, this.input.look.yaw);

      // Triggers are sampled after the player has moved, so a finish line or a
      // disco ball is detected at the position actually reached this frame.
      this.run.update(delta, player, elapsed);

      this.updateGuard(delta, player);

      // The death animation has run its course; place the player, preferring
      // the server's own transform when it has already arrived.
      if (player.deathComplete) this.applyPendingRespawn();

      // Still not placed. The prediction and the server disagreed about the
      // death, so ASK for a placement rather than sit frozen waiting for one
      // that was never coming.
      if (player.consumeRespawnNudge()) {
        logger.warn(SCOPE, 'death was not acknowledged; requesting a respawn');
        this.network.requestRespawn('manual');
      }

      this.snapCameraIfPlaced();
      this.camera.setTarget(player.position);
      this.sceneManager.followShadow(
        player.position.x,
        player.position.y,
        player.position.z,
      );
      this.flushInput();
    }

    if (player) this.playerAudio.update(delta, player);
    // The boards redraw only when the standings actually move, so handing them
    // the snapshot every frame costs a string compare.
    this.world.scoreboard.update(this.network.leaderboard);
    this.pops.update(delta);
    this.world.update(delta, elapsed);
    this.remotePlayers.advance(delta);
    this.camera.update(delta, player?.horizontalSpeed ?? 0);

    this.renderer.renderer.render(this.sceneManager.scene, this.camera.camera);
  }

  /**
   * Chase, and forfeit the run if it catches up.
   *
   * The guard does not decide the respawn - it reports a catch and the SERVER
   * places the player, exactly as it does for a disco ball. That keeps the one
   * rule this codebase has about placement intact: there is one destination
   * and only the server sends anybody to it.
   *
   * A dying player is not chased. The fall-over is already playing and the
   * respawn is already on its way, so a guard arriving during it would fire a
   * second request for a placement that is in flight.
   */
  private updateGuard(delta: number, player: LocalPlayer): void {
    if (player.isDying) {
      // A dead player is not being chased, whatever the monster was doing an
      // instant ago. Clearing the banner HERE rather than letting it linger is
      // what stops "THE MONSTER IS COMING" sitting over the fall-over and the
      // trip back to the arena.
      this.monsterWarning.setChasing(false);
      return;
    }

    // The stage the player is actually on, so the ramp follows progress
    // through the world rather than a banked count. 0 in the arena.
    const stage = stageAt(player.position.z)?.index ?? 0;
    this.guard.update(delta, player.position, player.maxRunSpeed, stage);

    // The banner reads the monster's OWN state and never a guess of its own,
    // so what the screen says and what the thing is doing cannot disagree.
    // `setChasing` writes to the DOM only when the answer actually flips.
    this.monsterWarning.setChasing(this.guard.isChasing);

    if (!this.guard.consumeCatch()) return;

    logger.info(SCOPE, `caught by the monster on stage ${stage}`);
    // It has arrived, so it is no longer coming.
    this.monsterWarning.setChasing(false);
    // The local fall-over starts now, so the catch is seen on the frame it
    // happened; the server confirms it with the authoritative Respawn.
    player.beginDeath();
    this.flushInput();
    this.network.requestRespawn('guard');
  }

  /**
   * Hand every simulated input to the network.
   *
   * Every one must be sent: the server advances only by the inputs it
   * receives, so a dropped input is authoritative movement that never happens.
   */
  private flushInput(): void {
    const player = this.localPlayer;
    if (!player) return;
    for (const message of player.drainOutgoing()) this.network.sendInput(message);
  }

  /**
   * Apply the server's respawn, once the death animation has finished.
   *
   * Held until then on purpose: applying it mid-animation would teleport the
   * character away from the fall the player is watching.
   */
  private applyPendingRespawn(): void {
    const player = this.localPlayer;
    const message = this.pendingRespawn;
    if (!player || !message) return;
    if (player.isDying && !player.deathComplete) return;

    this.pendingRespawn = null;
    player.teleport(message.x, message.y, message.z, message.rotationY);
    // A new run gets a new guard placement and a fresh grace window. Without
    // this the guard would still be standing wherever it caught them, half a
    // course away, and the next run would be unchased until it wandered back.
    this.guard.placeBehind(player.position, player.rotationY);
  }

  /** Arrive rather than ease whenever the player was PLACED, not moved. */
  private snapCameraIfPlaced(): void {
    const player = this.localPlayer;
    if (!player) return;
    const placement = player.consumePlacement();
    if (placement === 'none') return;
    // Only a respawn is allowed to be seen. A network correction must arrive
    // invisibly, or ordinary packet loss would fire the dolly.
    this.camera.snapTo(player.position, placement === 'respawn');
  }

  private onPlayerAdded(sessionId: string, state: NetPlayerState): void {
    if (sessionId === this.localSessionId) {
      this.applyLocalState(state);
      return;
    }
    this.remotePlayers.add(sessionId, state);
  }

  private onPlayerChanged(sessionId: string, state: NetPlayerState): void {
    if (sessionId === this.localSessionId) {
      this.applyLocalState(state);
      return;
    }
    this.remotePlayers.update(sessionId, state);
  }

  /**
   * Everything the server says about the local player.
   *
   * The client reconciles its prediction against the transform, adopts the
   * authoritative movement profile and renders the progression it is told to
   * render. It derives none of it.
   */
  private applyLocalState(state: NetPlayerState): void {
    const player = this.localPlayer;
    if (!player) return;

    player.setMovementProfile(state.moveMultiplier, state.jumpVelocity);

    if (state.ready) {
      player.reconcile({
        x: state.x,
        y: state.y,
        z: state.z,
        rotationY: state.rotationY,
        velocityX: state.velocityX,
        velocityY: state.velocityY,
        velocityZ: state.velocityZ,
        grounded: state.grounded,
        jumpCount: state.jumpCount,
        lastInputSeq: state.lastInputSeq,
        jumpLatched: state.jumpLatched,
        coyote: state.coyote,
      });
    }

    this.hud.update(state.totalSpeed, state.maxLevel, state.rebirths);
    // Only an INCREASE in the replicated total spawns a popup, so the figure
    // simply being re-sent on every patch never does.
    this.pops.observe(state.totalSpeed);
    this.wins.update(state.wins);
    this.run.setInventory(state.ownedTiers, state.wins, state.stageProgress);

    // Milestone sounds fire on the CHANGE, never on the value: a level is
    // re-sent on every patch, and playing on the level would be a fanfare
    // twenty times a second for as long as the player stayed at it.
    if (this.lastLevel >= 0 && state.level > this.lastLevel) this.audio.play('level');
    if (this.lastRebirths >= 0 && state.rebirths > this.lastRebirths) {
      this.audio.play('rebirth');
      // A rebirth zeroes the lifetime total, and the popups must not read that
      // drop as anything at all.
      this.pops.resetBaseline();
    }
    this.lastLevel = state.level;
    this.lastRebirths = state.rebirths;

    // The rail mirrors replicated state and decides nothing. A tile is "ready"
    // when the server would accept the request behind it right now.
    this.rebirthPanel.setProgress(state.level, state.rebirths);
    this.rebirthButton.setState(
      this.rebirthPanel.isEligible,
      !this.rebirthPanel.isEligible,
    );
    this.upgradePanel.setInventory(state.wins, state.ownedTiers);
    this.upgradeButton.setState(this.upgradePanel.hasAffordable);
    this.world.tiles.setInventory(state.ownedTiers, state.wins);

    if (state.ownedTiers !== this.lastOwnedTiers) {
      if (this.lastOwnedTiers !== -1) this.audio.play('claim');
      this.lastOwnedTiers = state.ownedTiers;
    }
  }

  private onStageAwarded(message: StageAwardedMessage): void {
    // The counter pops from the replicated total on the next patch anyway;
    // applying it here means the reward lands on the frame it was earned
    // rather than up to a patch later.
    this.launchWinFlight();
    this.wins.update(message.total);
    this.audio.play('win');
    logger.info(SCOPE, `stage ${message.stageIndex} banked: +${message.wins} wins`);
  }

  /**
   * Project the player to the screen and send the trophies from there.
   *
   * Falls back to the middle of the screen if there is no player yet, so the
   * effect can never be the thing that throws during an award.
   */
  private launchWinFlight(): void {
    const canvas = this.renderer.renderer.domElement;
    const box = canvas.getBoundingClientRect();
    let x = box.left + box.width / 2;
    let y = box.top + box.height / 2;

    const player = this.localPlayer;
    if (player) {
      WIN_FLIGHT_ORIGIN.copy(player.position);
      WIN_FLIGHT_ORIGIN.y += 2;
      WIN_FLIGHT_ORIGIN.project(this.camera.camera);
      // Behind the camera projects to a mirrored point in front of it, which
      // would fling the trophies off the wrong edge.
      if (WIN_FLIGHT_ORIGIN.z < 1) {
        x = box.left + ((WIN_FLIGHT_ORIGIN.x + 1) / 2) * box.width;
        y = box.top + ((1 - WIN_FLIGHT_ORIGIN.y) / 2) * box.height;
      }
    }

    this.winFlight.play(x, y);
  }

  private onStatusChange(status: ConnectionStatus): void {
    if (clientConfig.debug) logger.info(SCOPE, `connection: ${status}`);
  }

  dispose(): void {
    this.stop();
    this.hud.dispose();
    this.pops.dispose();
    this.wins.dispose();
    this.winFlight.dispose();
    this.monsterWarning.dispose();
    window.removeEventListener('keydown', this.onHotkey);
    window.removeEventListener('keydown', this.onGesture);
    window.removeEventListener('mousedown', this.onGesture);
    window.removeEventListener('touchstart', this.onGesture);
    this.audio.dispose();
    this.rebirthButton.dispose();
    this.upgradeButton.dispose();
    this.audioButton.dispose();
    this.rebirthPanel.dispose();
    this.upgradePanel.dispose();
    this.rail.remove();
    this.guard.dispose();
    this.remotePlayers.dispose();
    this.world.dispose();
    this.renderer.dispose();
  }
}
