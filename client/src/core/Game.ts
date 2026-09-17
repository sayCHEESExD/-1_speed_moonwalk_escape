import {
  BUNDLED_LOOK,
  GUEST_NAME,
  portraitUrlFor,
  SPAWN_POSITION,
  SPAWN_ROTATION_Y,
  stageAt,
  type AvatarLook,
  type RespawnMessage,
  type StageAwardedMessage,
} from '@moonwalk/shared';
import { Vector3 } from 'three';
import { AudioManager } from '../audio/AudioManager.js';
import { PlayerAudio } from '../audio/PlayerAudio.js';
import { Bloxity, GAME_SLUG } from '../bloxity/Bloxity.js';
import { BloxityAvatar } from '../bloxity/BloxityAvatar.js';
import { identityFromLegion } from '../bloxity/identity.js';
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
import { BloxityPanel } from '../ui/BloxityPanel.js';
import { MonsterWarning } from '../ui/MonsterWarning.js';
import { Nameplates } from '../ui/Nameplates.js';
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
 * How often the portal is re-asked who this player is, in seconds.
 *
 * Slow on purpose: this is a backstop for a missed `onUserChanged`, not a
 * polling loop. Nothing is sent unless the answer changed.
 */
const IDENTITY_RECHECK_SECONDS = 5;

/**
 * Milliseconds after our own join during which a remote player counts as
 * already HERE rather than as arriving - the difference between Bloxity's
 * "friend is in this room" and "friend just joined" toasts.
 */
const IN_ROOM_WINDOW_MS = 2500;

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
 *
 * BLOXITY is composed here and nowhere else. The renderer, audio, input and
 * network are handed to it as plain callbacks through `BloxityHost`, so none of
 * them imports the SDK and the whole integration degrades to nothing if the
 * script is blocked.
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

  private readonly bloxity: Bloxity;
  private readonly bloxityPanel: BloxityPanel;
  /** Cosmetics on the local character. Built once the model exists. */
  private bloxityAvatar: BloxityAvatar | null = null;
  /** The latest look, held until the character is built. */
  /** So an offline session says why it placed a death itself once, not per death. */
  private warnedOfflineRespawn = false;

  /** A look that arrived before there was a character to put it on. */
  private pendingLook: AvatarLook | null = null;

  /** The name chips over every player's head, the local one included. */
  private readonly nameplates: Nameplates;
  /**
   * The local player's name and portrait, as the SERVER echoed them back.
   *
   * Read off replicated state rather than from the SDK directly, so the plate
   * over your own head says exactly what everybody else's screen says about
   * you - including the sanitising the server applied.
   */
  private localName = '';
  private localPfp = '';
  /** The identity last sent, so an unchanged one is not re-sent every frame. */
  private lastIdentity = '';
  /** Seconds since the portal identity was last re-checked. */
  private identityTimer = 0;
  /** Remote players already announced to Bloxity, so a name is toasted once. */
  private readonly announced = new Set<string>();
  private joinedAt = 0;

  /** The portal's `show_fps` readout. */
  private readonly fpsReadout: HTMLDivElement;
  private fpsAccum = 0;
  private fpsFrames = 0;

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
    this.nameplates = new Nameplates(container);
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

    this.fpsReadout = document.createElement('div');
    this.fpsReadout.className = 'mwe-fps mwe-font';
    this.fpsReadout.hidden = true;
    container.appendChild(this.fpsReadout);

    window.addEventListener('keydown', this.onHotkey);
    // Audio can only start on a real gesture, and no single one of them is
    // guaranteed to be the one the browser accepts - so every gesture asks,
    // and `resume` is written to be safe to call repeatedly.
    window.addEventListener('keydown', this.onGesture);
    window.addEventListener('mousedown', this.onGesture);
    window.addEventListener('touchstart', this.onGesture, { passive: true });

    this.renderer.onResize((width, height) => {
      this.camera.setViewport(width, height);
      // Handed in rather than measured per frame, so placing plates never
      // forces a layout.
      this.nameplates.setViewport(width, height);
    });

    this.network = new NetworkClient({
      onStatusChange: (status) => this.onStatusChange(status),
      onSelfJoined: (sessionId) => {
        this.localSessionId = sessionId;
        this.joinedAt = performance.now();
        // Published as soon as the room is joinable, so an invite lands the
        // friend in THIS room rather than merely in the game.
        const roomId = this.network.roomId;
        this.bloxity.updateRoom(roomId);
        this.bloxityPanel.setRoom(roomId);
      },
      onPlayerAdded: (sessionId, player) => this.onPlayerAdded(sessionId, player),
      onPlayerChanged: (sessionId, player) => this.onPlayerChanged(sessionId, player),
      onPlayerRemoved: (sessionId) => {
        this.announced.delete(sessionId);
        this.remotePlayers.remove(sessionId);
      },
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

    /*
     * The Bloxity bridge. Everything Bloxity can change about the game arrives
     * through these callbacks, and nothing else in the codebase imports the SDK.
     */
    this.bloxity = new Bloxity({
      setMasterVolume: (level) => this.audio.setMasterVolume(level),
      setMusicVolume: (level) => this.audio.setMusicVolume(level),
      setGraphicsQuality: (level) => this.renderer.setQuality(level),
      setShowFps: (show) => {
        this.fpsReadout.hidden = !show;
      },
      setCameraSensitivity: (scale) => this.input.look.setSensitivityScale(scale),
      // The portal asks; the SERVER still decides where anyone is placed.
      respawn: () => {
        if (!this.localPlayer?.isDying) this.network.requestRespawn('manual');
      },
      pointerLockChanged: (locked) => this.input.look.setCursorFree(!locked),
      /*
       * ONE look, three destinations: the local character wears it, the server
       * replicates it so every other player draws this player correctly, and
       * the panel redraws its sliders. There is no second source for any of
       * the three - what Bloxity says is what all of them get.
       */
      lookChanged: (look) => {
        if (this.bloxityAvatar) this.bloxityAvatar.apply(look);
        else this.pendingLook = look;
        this.network.sendAvatarLook(look);
        this.bloxityPanel.refreshAvatar();
        // A portrait is a RENDER of the avatar, so a new look is a new
        // portrait - and for a player with no account picture it is the only
        // portrait they have.
        this.syncIdentity();
      },
      /*
       * A login or logout after joining.
       *
       * Two separate things travel, because they answer two different
       * questions. The TOKEN goes to the server to be verified, and decides
       * only who a Bux purchase belongs to. The NAME and PORTRAIT go as a
       * plain identity, which the server sanitises and replicates - that is
       * what every nameplate and every board row shows.
       */
      identityChanged: (user, token) => {
        this.network.sendBloxityToken(token);
        this.syncIdentity(user);
      },
    });
    this.network.setIdentityProvider(() => this.bloxity.getToken());
    // Read at JOIN time, not from a cached message. See `setProfileProvider`.
    this.network.setProfileProvider(() => identityFromLegion(this.bloxity.getUser()));
    this.bloxityPanel = new BloxityPanel(container, this.bloxity);

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
        this.bloxityPanel.closeAll();
        this.input.look.setCursorFree(true);
        // Embedded, the portal owns the pause menu; standalone this is a no-op.
        if (this.bloxity.embedded) this.bloxity.showPortalMenu(true);
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
    this.bloxityPanel.closeAll();
    panel.toggle();
  }

  /**
   * Initialise Bloxity.
   *
   * Called before anything loads, because the portal's loading screen is fed
   * by `loadingStep` and has to be listening before there is anything to report.
   */
  startBloxity(): void {
    this.bloxity.start();
  }

  /** Progress, for the portal's loading screen. */
  loadingStep(text: string): void {
    this.bloxity.loadingStep(text);
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

    /*
     * Cosmetics on the LOCAL character, built AFTER the bundled model exists
     * and bound to it - so the Bloxity body replaces the bundled one and never
     * the other way round. A look that arrived while the FBX was still loading
     * was parked in `pendingLook` for exactly this moment; without that, a
     * player whose avatar resolved quickly would have been dressed into a
     * character that did not exist yet, and would then have kept the bundled
     * texture for the whole session.
     */
    this.bloxityAvatar = new BloxityAvatar(this.localPlayer.character);
    const look = this.pendingLook ?? this.bloxity.getLook();
    this.pendingLook = null;
    this.bloxityAvatar.apply(look);
    this.network.sendAvatarLook(look);
    // Who the portal already says this is, ready to travel with the join.
    this.syncIdentity();

    logger.info(SCOPE, 'world ready');
    return this.modelReport;
  }

  /** Join the Colyseus room. Rendering continues even if this fails. */
  async connect(): Promise<void> {
    await this.network.connect();
  }

  start(): void {
    this.input.attach(this.renderer.renderer.domElement);
    // Once, after the join and any portal login have had a moment to land.
    window.setTimeout(() => this.diagnose(), 3000);
    // The loading screen comes down and the session begins.
    this.bloxity.loadingEnd();
    this.bloxity.gameplayStart();
  }

  stop(): void {
    this.input.detach();
    this.bloxity.gameplayEnd();
    // Out of the room, so a friend is not invited into a game nobody is in.
    this.bloxity.updateRoom('');
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

      // Slow re-check of who the portal says this is. See `syncIdentity`.
      this.identityTimer += delta;
      if (this.identityTimer >= IDENTITY_RECHECK_SECONDS) {
        this.identityTimer = 0;
        this.syncIdentity();
      }

      // The death animation has run its course; place the player, preferring
      // the server's own transform when it has already arrived.
      if (player.deathComplete) this.applyPendingRespawn();

      // Still not placed. The prediction and the server disagreed about the
      // death, so ASK for a placement rather than sit frozen waiting for one
      // that was never coming.
      // A DEAD player only. The nudge cannot fire for a live one - it counts
      // from the end of the fall-over - and this says so out loud anyway,
      // because anything that can place a living player is one flapping socket
      // away from teleporting them to spawn twice a second.
      if (player.isDying && player.consumeRespawnNudge()) {
        if (this.network.inRoom) {
          logger.warn(SCOPE, 'death was not acknowledged; requesting a respawn');
          this.network.requestRespawn('manual');
        } else {
          this.placeOffline(player);
        }
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
    this.tickFps(delta);

    this.renderer.renderer.render(this.sceneManager.scene, this.camera.camera);
    // After the render, from the matrices it just computed - see Nameplates.
    this.updateNameplates();
  }

  /** The `show_fps` readout, averaged over half a second so it is readable. */
  private tickFps(delta: number): void {
    if (this.fpsReadout.hidden) return;
    this.fpsAccum += delta;
    this.fpsFrames += 1;
    if (this.fpsAccum < 0.5) return;
    this.fpsReadout.textContent = `${Math.round(this.fpsFrames / this.fpsAccum)} FPS`;
    this.fpsAccum = 0;
    this.fpsFrames = 0;
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

  /**
   * Place a dead player at the arena when there is NO server to ask.
   *
   * The server owns placement, and that does not change - but "the server
   * decides" has no answer when there is no server, and this game deliberately
   * keeps rendering and moving with none (a failed join says so and plays on).
   * Without this the first death is the end of the session: the fall-over
   * finishes, the request for a placement goes into a closed socket, and the
   * player sits at the spot they died on for ever. That is a real state -
   * a crashed server, a dead deployment, another game holding this one's port -
   * and it is exactly what it looked like.
   *
   * There is nothing to cheat here and nothing to gain: an offline session
   * awards no Speed, no Wins and no stages, because all of those are the
   * server's. This places the character, and only the character, at the SAME
   * spawn constant the server would have used.
   */
  private placeOffline(player: LocalPlayer): void {
    if (!this.warnedOfflineRespawn) {
      this.warnedOfflineRespawn = true;
      logger.warn(
        SCOPE,
        'not connected to a game server, so this death was placed locally. ' +
          'Progression is server-owned and will not advance until the session ' +
          'reconnects.',
      );
    }
    player.teleport(SPAWN_POSITION.x, SPAWN_POSITION.y, SPAWN_POSITION.z, SPAWN_ROTATION_Y);
    this.guard.placeBehind(player.position, player.rotationY);
  }

  /**
   * Print what is ACTUALLY true at runtime, once, a moment after start-up.
   *
   * Every "the player shows as Guest" and "the avatar is wrong" report so far
   * has come down to a question nobody could answer from the outside: which
   * server did the browser reach, did the room accept it, was anyone signed in
   * when the join was built, and did the name and the look survive the trip.
   * Guessing at those cost several rounds, so the game now says.
   *
   * Names are printed; the TOKEN never is - only whether one exists and how
   * long it is. This is a diagnostic, not a credential dump.
   */
  diagnose(): Record<string, unknown> {
    const user = this.bloxity.getUser();
    const token = this.bloxity.getToken();
    const state = this.network.playerState(this.network.sessionId ?? '');
    const report = {
      /*
       * The flat summary first, in the shape the operator asked for: one glance
       * says which build, which server, whether it joined, who Bloxity thinks
       * this is, what was sent, what came back, and whether progression moved.
       * The grouped detail below stays for tracing a specific link.
       */
      buildVersion: clientConfig.buildVersion,
      serverBuild: this.network.build,
      serverUrl: clientConfig.serverUrl || '(none configured)',
      connectionStatus: this.network.connectionStatus,
      inRoom: this.network.inRoom,
      roomId: this.network.roomId,
      sessionId: this.network.sessionId ?? '',
      authenticated: this.bloxity.isLoggedIn(),
      bloxityName: user?.displayName ?? '',
      bloxityUsername: user?.username ?? '',
      bloxityIsGuest: user?.isGuest === true,
      identitySentToServer: this.lastIdentity.split('\u0000')[0] ?? '',
      replicatedPlayerName: state?.displayName ?? '',
      totalSpeed: state ? Math.round(state.totalSpeed) : null,
      level: state?.level ?? null,
      maxLevel: state?.maxLevel ?? null,
      sdk: {
        scriptPresent: this.bloxity.available,
        initialised: this.bloxity.initialised,
        environment: this.bloxity.embedded ? 'embedded' : 'standalone',
        gameSlug: GAME_SLUG,
        isLoggedIn: this.bloxity.isLoggedIn(),
        user: user
          ? {
              displayName: user.displayName ?? '',
              username: user.username ?? '',
              isGuest: user.isGuest === true,
              hasPfp: Boolean(user.pfp),
            }
          : null,
        tokenLength: token ? token.length : 0,
      },
      identitySent: this.lastIdentity.split('\u0000'),
      connection: {
        serverUrl: clientConfig.serverUrl || '(none configured)',
        status: this.network.connectionStatus,
        inRoom: this.network.inRoom,
        roomId: this.network.roomId,
        sessionId: this.network.sessionId ?? '',
      },
      replicatedForMe: state
        ? {
            displayName: state.displayName,
            avatarUrl: state.avatarUrl,
            hasAvatarField: 'avatar' in state,
            avatarBloxity: state.avatar?.bloxity,
            avatarSkin: state.avatar?.skin,
            avatarHat: state.avatar?.hat,
            avatarHeight: state.avatar?.height,
          }
        : '(no player state yet)',
      /*
       * PROGRESSION, because "my level is frozen" and "everyone is a guest"
       * have the same likeliest cause and it is not in this code: Speed is
       * granted by the SERVER from movement it observes, so a session that is
       * not in a room cannot level up and cannot be named either. This says
       * which of the two it is without another round of guessing.
       */
      progression: state
        ? {
            totalSpeed: Math.round(state.totalSpeed),
            level: state.level,
            maxLevel: state.maxLevel,
            speedPerStep: state.speedPerStep,
            moveMultiplier: state.moveMultiplier,
            note: this.network.inRoom
              ? 'the server is crediting Speed; the level follows from it'
              : 'NOT IN A ROOM - Speed is server-granted, so nothing can level up',
          }
        : '(no player state yet)',
      localLook: this.bloxityAvatar?.current ?? '(avatar not built yet)',
      remotePlayers: [...this.remotePlayers.entries()].map(([id, remote]) => ({
        sessionId: id,
        displayName: remote.displayName,
        look: remote.look,
      })),
      leaderboardTop: this.network.leaderboard?.speed
        .filter((row) => row.name)
        .slice(0, 3)
        .map((row) => `${row.name}: ${Math.round(row.value)}`),
    };
    logger.info(SCOPE, 'runtime diagnostic:', report);
    return report;
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

  /**
   * Send the portal identity if it differs from what was last sent.
   *
   * Called on every login and logout, once at start-up, and from a slow
   * re-check - never per frame. `getUser()` is asked each time rather than a
   * cached user being kept, which is the SDK's own rule for this.
   *
   * The re-check exists because `onUserChanged` is a third party's promise,
   * not a guarantee: a session that signs in while the SDK is mid-handshake,
   * or a build that resolves the profile without re-emitting, would otherwise
   * stay nameless for ever with a perfectly good user sitting in `getUser()`.
   * It SENDS NOTHING unless the answer actually changed, so an idle signed-out
   * player costs one function call every few seconds and no traffic at all.
   * It cannot move anybody: the only thing it can do is set a name.
   */
  private syncIdentity(user = this.bloxity.getUser()): void {
    const identity = identityFromLegion(user);
    const key = `${identity.name}\u0000${identity.pfp}`;
    if (key === this.lastIdentity) return;
    this.lastIdentity = key;
    /*
     * One line, on CHANGE only, naming what the portal gave and what is being
     * sent. This is the first link of the chain that ends in a nameplate, and
     * when it reads "no usable name" the fault is upstream of this game -
     * which is a question that has cost several rounds to answer without it.
     */
    logger.info(
      SCOPE,
      identity.name
        ? `identity: sending "${identity.name}" (portrait ${identity.pfp ? 'yes' : 'no'})`
        : 'identity: the SDK gave no usable name ' +
            `(user=${user ? 'present' : 'none'}, ` +
            `displayName=${JSON.stringify(user?.displayName ?? null)}, ` +
            `username=${JSON.stringify(user?.username ?? null)})`,
    );
    this.network.sendIdentity(identity);
  }

  /**
   * Every player's plate, local included, from replicated names only.
   *
   * Replicated rather than local, even for the local player: one source means
   * the name over your own head cannot disagree with the one everybody else
   * sees. A player the server has no name for shows `GUEST_NAME`, the same
   * word the boards use for them.
   */
  private updateNameplates(): void {
    const plates = this.nameplates;
    plates.begin(this.camera.camera);
    const player = this.localPlayer;
    if (player) {
      plates.put(
        'local',
        player.character,
        this.localName || GUEST_NAME,
        this.localPfp || portraitUrlFor(this.bloxityAvatar?.current ?? BUNDLED_LOOK),
      );
    }
    for (const [sessionId, remote] of this.remotePlayers.entries()) {
      // Their account picture when they have one, otherwise Bloxity's render
      // of the look they are actually wearing - which is on the wire, so it is
      // theirs and cannot be anybody else's.
      plates.put(
        sessionId,
        remote.character,
        remote.displayName || GUEST_NAME,
        remote.pfp || portraitUrlFor(remote.look),
      );
    }
    plates.end();
  }

  private onPlayerAdded(sessionId: string, state: NetPlayerState): void {
    if (sessionId === this.localSessionId) {
      this.applyLocalState(state);
      return;
    }
    this.remotePlayers.add(sessionId, state);
    this.announce(sessionId, state);
  }

  private onPlayerChanged(sessionId: string, state: NetPlayerState): void {
    if (sessionId === this.localSessionId) {
      this.applyLocalState(state);
      return;
    }
    this.remotePlayers.update(sessionId, state);
    // A verified name arrives a moment after the player does.
    this.announce(sessionId, state);
  }

  /**
   * Tell Bloxity who is here, once per player, by their Bloxity name.
   *
   * Only players whose name the SERVER verified are announced - a guest has no
   * Bloxity identity for the portal to match against the friends list.
   */
  private announce(sessionId: string, state: NetPlayerState): void {
    if (!state.displayName || this.announced.has(sessionId)) return;
    this.announced.add(sessionId);
    if (performance.now() - this.joinedAt < IN_ROOM_WINDOW_MS) {
      this.bloxity.playerInRoom(state.displayName);
    } else {
      this.bloxity.playerJoined(state.displayName);
    }
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

    // The server's own copy of this player's identity, sanitised - the same
    // field every other client reads for them, so the plate over your head
    // says what everybody else's screen says.
    this.localName = state.displayName ?? '';
    this.localPfp = state.avatarUrl ?? '';

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
    this.bloxityPanel.dispose();
    this.nameplates.dispose();
    this.bloxityAvatar?.dispose();
    this.bloxity.dispose();
    this.fpsReadout.remove();
    this.rail.remove();
    this.guard.dispose();
    this.remotePlayers.dispose();
    this.world.dispose();
    this.renderer.dispose();
  }
}
