import type { AudioManager } from './AudioManager.js';

/**
 * World units of travel between heel pops at ordinary speed.
 *
 * The same figure the moonwalk cycle advances its phase by, so the scuff you
 * hear lands on the foot you can see move.
 */
const STRIDE = 3.4;

/**
 * Most scuffs a second, however fast the player is going.
 *
 * The same reasoning as the moonwalk's cadence clamp: a level-60 player covers
 * hundreds of units a second, and a beat per stride at that speed is not a
 * dance, it is a buzz. The sense of pace comes from the world going past - the
 * audio only has to say "shoes on carpet".
 */
const MAX_BEATS_PER_SECOND = 7;

/** Below this, the player is not really moving and should be silent. */
const MIN_AUDIBLE_SPEED = 2.5;

/** What the audio layer needs to know about the player. Read-only. */
export interface PlayerAudioInput {
  readonly horizontalSpeed: number;
  readonly maxRunSpeed: number;
  readonly isGrounded: boolean;
  readonly justJumped: boolean;
  readonly justLanded: boolean;
  readonly isDying: boolean;
}

/**
 * Turns what the local player is doing into sounds.
 *
 * Deliberately separate from `AudioManager`: one knows how to make a noise,
 * the other knows when the game wants one. Game code then has a single
 * `update` to call, and no part of the renderer or the simulation ends up with
 * an opinion about audio.
 *
 * ONLY the local player is fed through here. Remote players are drawn and
 * animated but silent, because eight of them gliding past would bury the one
 * character whose footfalls actually tell the player something.
 */
export class PlayerAudio {
  private readonly audio: AudioManager;

  /** Distance since the last scuff. */
  private stride = 0;
  /** Seconds since the last scuff, for the cadence clamp. */
  private sinceBeat = 0;
  /** So a death fires once per death rather than once per frame. */
  private wasDying = false;

  constructor(audio: AudioManager) {
    this.audio = audio;
  }

  update(delta: number, player: PlayerAudioInput): void {
    // A death is an EDGE. `isDying` stays true for the whole fall-over, and
    // playing on the level rather than the edge would retrigger it every frame
    // for the length of the animation.
    if (player.isDying) {
      if (!this.wasDying) {
        this.wasDying = true;
        this.audio.play('death');
      }
      this.stride = 0;
      return;
    }
    this.wasDying = false;

    if (player.justJumped) this.audio.play('jump');
    if (player.justLanded) this.audio.play('land', this.loudness(player));

    this.sinceBeat += delta;
    if (!player.isGrounded || player.horizontalSpeed < MIN_AUDIBLE_SPEED) {
      this.stride = 0;
      return;
    }

    this.stride += player.horizontalSpeed * delta;
    if (this.stride < STRIDE) return;
    if (this.sinceBeat < 1 / MAX_BEATS_PER_SECOND) {
      // Over the cadence ceiling: drop the beat rather than banking it, or a
      // fast player would pay off a debt of scuffs the moment they slowed.
      this.stride = 0;
      return;
    }

    this.stride = 0;
    this.sinceBeat = 0;
    this.audio.play('step', this.loudness(player));
  }

  /** Louder the faster the player is going, as a fraction of their top speed. */
  private loudness(player: PlayerAudioInput): number {
    const top = Math.max(1, player.maxRunSpeed);
    return Math.min(player.horizontalSpeed / top, 1);
  }
}
