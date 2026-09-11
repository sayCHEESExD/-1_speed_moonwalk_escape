import { logger } from '../util/logger.js';

const SCOPE = 'audio';

/** Master volumes per category. Music sits well under the gameplay sounds. */
const SFX_GAIN = 0.34;
const MUSIC_GAIN = 0.4;

/**
 * The supplied audio, served from the repo-level `assets/` folder.
 *
 * Vite publishes that folder as the web ROOT (`publicDir` points at it), so
 * these paths are what the files are reachable at in dev and in the production
 * build alike - there is no second copy inside the client workspace and no
 * bundler rewriting that could go wrong between the two.
 */
const AUDIO_URL = {
  /** Streamed. See `startMusic` for why this one is not decoded. */
  background: '/audio/background.mp3',
  /** Decoded into buffers: short, and they must fire on the exact frame. */
  jump: '/audio/jump.mp3',
  death: '/audio/death.mp3',
} as const;

/** The one-shots that come from a FILE rather than from an oscillator. */
const SAMPLED = ['jump', 'death'] as const;
type SampledName = (typeof SAMPLED)[number];

/**
 * Most one-shot voices allowed to sound at once.
 *
 * A ceiling rather than a hope. Web Audio nodes are one-shot by design - a
 * source cannot be replayed, so every sound is a new node - and the thing that
 * has to be bounded is therefore how many are alive at any moment, not how
 * many are ever made. Beyond this, a request is dropped rather than queued:
 * the twenty-first simultaneous footfall is inaudible anyway.
 */
const MAX_VOICES = 12;

/** Keep a volume inside 0..1 whatever was asked for. */
const clamp01 = (value: number): number =>
  Number.isFinite(value) ? Math.min(Math.max(value, 0), 1) : 1;

/** Seconds a given sound refuses to retrigger, so nothing can machine-gun. */
const COOLDOWNS: Readonly<Record<SoundName, number>> = {
  jump: 0.12,
  land: 0.14,
  step: 0.05,
  death: 0.6,
  win: 0.4,
  level: 0.4,
  rebirth: 0.8,
  claim: 0.3,
};

export type SoundName =
  | 'jump'
  | 'land'
  | 'step'
  | 'death'
  | 'win'
  | 'level'
  | 'rebirth'
  | 'claim';

/**
 * Every sound in the game, synthesised.
 *
 * Most of them are synthesised - oscillators and envelopes cost bytes measured
 * in the hundreds. The SUPPLIED files are the exception and the priority: the
 * background track, the jump and the death all come from `assets/audio/`,
 * because a tune is the one thing an oscillator cannot fake and because those
 * two cues carry more weight than any other sound in the game.
 *
 * TWO rules hold the whole thing together:
 *
 *  - ONE-SHOTS ARE BOUNDED, twice: a per-sound cooldown stops the same effect
 *    retriggering every frame, and a hard voice ceiling stops the mix from
 *    ever containing more than a dozen of them.
 *  - ONLY THE LOCAL PLAYER makes noise. A busy room would otherwise put a
 *    footfall, a jump and a death from every other player into a mix the
 *    player is trying to hear their own moves in.
 *
 * Nothing here starts until the player's first gesture: browsers refuse to run
 * an AudioContext before one, and a context created earlier merely sits
 * suspended and confuses everything downstream.
 */
export class AudioManager {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private sfxBus: GainNode | null = null;
  private musicBus: GainNode | null = null;

  /**
   * The background track, as a streaming element rather than a decoded buffer.
   *
   * `decodeAudioData` would hold the whole thing in memory uncompressed - a
   * four-hundred-kilobyte mp3 is tens of megabytes of samples once decoded,
   * for something that is only ever played end to end. An element streams it,
   * loops it natively, and still routes through Web Audio, which is what keeps
   * the master volume and the mute working on it.
   */
  private musicElement: HTMLAudioElement | null = null;
  private musicSource: MediaElementAudioSourceNode | null = null;

  /**
   * The decoded one-shots.
   *
   * Jump and death are SHORT and have to land on the frame they are asked for,
   * so they are decoded once into buffers rather than streamed - an element
   * carries a start latency a jump cue cannot afford. A name missing from here
   * simply has not finished loading, or failed to, and `play` falls back to the
   * synthesised version rather than going silent.
   */
  private readonly samples = new Map<SampledName, AudioBuffer>();
  /** True once the fetch has been kicked off, so it happens exactly once. */
  private loadingSamples = false;

  /** Live one-shot voices, so the ceiling can be enforced. */
  private voices = 0;
  /** Wall-clock of the last play, per sound. */
  private readonly lastPlayed = new Map<SoundName, number>();

  private muted = false;
  private started = false;

  /** Master and music volumes, 0..1. Both default to full. */
  private masterLevel = 1;
  private musicLevel = 1;

  /**
   * Bring the audio up, on a real user gesture.
   *
   * Safe to call repeatedly - it is wired to every gesture precisely because
   * no single one of them is guaranteed to be the one the browser accepts.
   */
  resume(): void {
    if (this.muted) return;
    if (!this.context) {
      try {
        const Ctor =
          window.AudioContext ??
          (window as unknown as { webkitAudioContext?: typeof AudioContext })
            .webkitAudioContext;
        if (!Ctor) return;
        this.context = new Ctor();
      } catch (error) {
        logger.warn(SCOPE, `no audio context: ${String(error)}`);
        return;
      }

      this.master = this.context.createGain();
      // Built at the level the portal has ALREADY set: settings arrive before
      // the first user gesture, so a context created at full volume would be
      // loud for exactly as long as it took the next slider change to arrive.
      this.master.gain.value = this.muted ? 0 : this.masterLevel;
      this.master.connect(this.context.destination);


      this.sfxBus = this.context.createGain();
      this.sfxBus.gain.value = SFX_GAIN;
      this.sfxBus.connect(this.master);

      this.musicBus = this.context.createGain();
      this.musicBus.gain.value = MUSIC_GAIN * this.musicLevel;
      this.musicBus.connect(this.master);
    }

    void this.context.resume().catch(() => undefined);
    void this.loadSamples();

    if (!this.started) {
      this.started = true;
      this.startMusic();
      logger.info(SCOPE, 'audio started');
    }

    // A tab that was backgrounded pauses the element; coming back has to
    // restart it, and `play()` on an already-playing element is a no-op.
    if (this.musicElement && !this.muted) {
      void this.musicElement.play().catch(() => undefined);
    }
  }

  get isMuted(): boolean {
    return this.muted;
  }

  /** Silence everything, or bring it back. */
  setMuted(muted: boolean): void {
    this.muted = muted;
    this.applyMaster();
  }

  /**
   * Master volume, 0..1.
   *
   * Kept SEPARATE from mute rather than folded into it: they are two different
   * statements - "I set this to 30%" and "silence, now" - and a mute that
   * overwrote the level would hand back the wrong one when it lifted. The
   * master gain is the product of the two, so unmuting restores whatever the
   * slider said.
   */
  setMasterVolume(level: number): void {
    this.masterLevel = clamp01(level);
    this.applyMaster();
  }

  /** The music volume, 0..1, against the game's own tuned mix. */
  setMusicVolume(level: number): void {
    this.musicLevel = clamp01(level);
    if (!this.musicBus || !this.context) return;
    this.musicBus.gain.setTargetAtTime(
      MUSIC_GAIN * this.musicLevel,
      this.context.currentTime,
      0.05,
    );
  }

  private applyMaster(): void {
    if (this.master && this.context) {
      const target = this.muted ? 0 : this.masterLevel;
      this.master.gain.setTargetAtTime(target, this.context.currentTime, 0.05);
    }

    // A muted stream is PAUSED, not merely turned down. Leaving it running
    // would keep decoding a file nobody can hear, and on a phone that is
    // battery spent on nothing.
    const element = this.musicElement;
    if (!element) return;
    if (this.muted) element.pause();
    else void element.play().catch(() => undefined);
  }

  toggleMuted(): boolean {
    this.setMuted(!this.muted);
    return this.muted;
  }

  /**
   * Play a one-shot.
   *
   * Refused if the same sound played within its cooldown, or if the voice
   * ceiling is already reached. Both refusals are silent: a sound that cannot
   * be heard is not an error.
   */
  play(name: SoundName, intensity = 1): void {
    const ctx = this.context;
    const bus = this.sfxBus;
    if (!ctx || !bus || this.muted || ctx.state !== 'running') return;

    const now = ctx.currentTime;
    const last = this.lastPlayed.get(name) ?? -Infinity;
    if (now - last < COOLDOWNS[name]) return;
    if (this.voices >= MAX_VOICES) return;
    this.lastPlayed.set(name, now);

    const level = Math.min(Math.max(intensity, 0), 1);
    switch (name) {
      case 'jump':
        // The supplied jump sound. The synthesised blip is the FALLBACK, not
        // the intent: it covers the window before the file has decoded and the
        // case where it never does, so a jump is never silent.
        if (!this.playSample('jump', now, 0.9)) {
          this.blip(now, 'square', 320, 640, 0.16, 0.5 * level);
        }
        break;
      case 'land':
        this.thud(now, 0.35 + level * 0.3);
        break;
      case 'step':
        // The heel pop. Deliberately a soft, short scuff rather than a click:
        // this is a shoe sliding on carpet, and it plays a few times a second.
        this.thud(now, 0.09 + level * 0.12, 110);
        break;
      case 'death':
        if (!this.playSample('death', now, 1)) {
          this.blip(now, 'sawtooth', 300, 70, 0.5, 0.6);
        }
        break;
      case 'win':
        this.arpeggio(now, [0, 4, 7, 12], 0.09, 'triangle', 0.5);
        break;
      case 'level':
        this.arpeggio(now, [0, 7, 12], 0.07, 'triangle', 0.4);
        break;
      case 'rebirth':
        this.arpeggio(now, [0, 4, 7, 12, 16, 19], 0.08, 'sawtooth', 0.45);
        break;
      case 'claim':
        this.arpeggio(now, [0, 5, 9], 0.06, 'square', 0.35);
        break;
    }
  }

  dispose(): void {
    if (this.musicElement) {
      this.musicElement.pause();
      // Dropping the src releases the network request and the decoder; an
      // element left holding a stream keeps both alive after the game is gone.
      this.musicElement.removeAttribute('src');
      this.musicElement.load();
    }
    this.musicSource?.disconnect();
    this.musicSource = null;
    this.musicElement = null;
    this.samples.clear();
    this.started = false;
    void this.context?.close().catch(() => undefined);
    this.context = null;
    this.master = null;
    this.musicBus = null;
    this.sfxBus = null;
  }

  // ----------------------------------------------------- the supplied audio

  /**
   * Start the background track.
   *
   * Called ONCE, from the first `resume()`, which is the first real user
   * gesture - browsers refuse to play audio before one. The `started` flag is
   * what makes a second copy of the track impossible rather than merely
   * unlikely.
   */
  private startMusic(): void {
    const ctx = this.context;
    const bus = this.musicBus;
    if (!ctx || !bus || this.musicElement) return;

    try {
      const element = new Audio();
      // Loop BEFORE the source is set, so the first pass round is seamless
      // rather than the one gap the player actually hears.
      element.loop = true;
      element.preload = 'auto';
      // The element's own volume stays at 1: the mix belongs to `musicBus`,
      // and two independent volume controls on one sound is one too many.
      element.volume = 1;
      element.src = AUDIO_URL.background;

      const source = ctx.createMediaElementSource(element);
      source.connect(bus);

      this.musicElement = element;
      this.musicSource = source;

      element.addEventListener('error', () => {
        logger.warn(SCOPE, 'background music failed to load from ' + AUDIO_URL.background);
      });

      if (!this.muted) void element.play().catch(() => undefined);
    } catch (error) {
      // No music is a worse game, not a broken one.
      logger.warn(SCOPE, 'could not start background music: ' + String(error));
    }
  }

  /**
   * Fetch and decode the sampled one-shots, once.
   *
   * A failure is logged and then forgotten: the synthesised fallback in `play`
   * covers it, so a missing file costs the game its better jump sound and
   * nothing else.
   */
  private async loadSamples(): Promise<void> {
    const ctx = this.context;
    if (!ctx || this.loadingSamples) return;
    this.loadingSamples = true;

    await Promise.all(
      SAMPLED.map(async (name) => {
        try {
          const response = await fetch(AUDIO_URL[name]);
          if (!response.ok) throw new Error('HTTP ' + response.status);
          const encoded = await response.arrayBuffer();
          this.samples.set(name, await ctx.decodeAudioData(encoded));
        } catch (error) {
          logger.warn(SCOPE, 'could not load ' + AUDIO_URL[name] + ': ' + String(error));
        }
      }),
    );
  }

  /**
   * Play a decoded sample, if it is ready.
   *
   * @returns false when there is nothing to play, so the caller can fall back
   *          to the synthesised version rather than producing silence.
   */
  private playSample(name: SampledName, at: number, gain: number): boolean {
    const ctx = this.context;
    const bus = this.sfxBus;
    const buffer = this.samples.get(name);
    if (!ctx || !bus || !buffer) return false;

    const source = ctx.createBufferSource();
    source.buffer = buffer;
    const envelope = ctx.createGain();
    envelope.gain.value = gain;
    source.connect(envelope);
    envelope.connect(bus);

    // Counted against the same voice ceiling every other one-shot is, so a
    // sampled sound cannot quietly escape the bound that holds the synth ones.
    this.voices += 1;
    source.onended = () => {
      this.voices = Math.max(0, this.voices - 1);
      source.disconnect();
      envelope.disconnect();
    };
    source.start(at);
    return true;
  }

  // --------------------------------------------------------- the one-shots

  private blip(
    at: number,
    shape: OscillatorType,
    from: number,
    to: number,
    length: number,
    gain: number,
  ): void {
    const ctx = this.context;
    const bus = this.sfxBus;
    if (!ctx || !bus) return;

    const osc = ctx.createOscillator();
    osc.type = shape;
    osc.frequency.setValueAtTime(from, at);
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, to), at + length);

    const envelope = ctx.createGain();
    envelope.gain.setValueAtTime(0.0001, at);
    envelope.gain.exponentialRampToValueAtTime(gain, at + 0.01);
    envelope.gain.exponentialRampToValueAtTime(0.0001, at + length);

    osc.connect(envelope);
    envelope.connect(bus);
    this.hold(osc, envelope, at, length);
  }

  /** A hoof on the ground: a short filtered noise burst with a low thump. */
  private thud(at: number, gain: number, frequency = 150): void {
    const ctx = this.context;
    const bus = this.sfxBus;
    if (!ctx || !bus) return;

    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(frequency, at);
    osc.frequency.exponentialRampToValueAtTime(frequency * 0.45, at + 0.09);

    const envelope = ctx.createGain();
    envelope.gain.setValueAtTime(0.0001, at);
    envelope.gain.exponentialRampToValueAtTime(gain, at + 0.008);
    envelope.gain.exponentialRampToValueAtTime(0.0001, at + 0.12);

    osc.connect(envelope);
    envelope.connect(bus);
    this.hold(osc, envelope, at, 0.12);
  }

  private arpeggio(
    at: number,
    semitones: readonly number[],
    step: number,
    shape: OscillatorType,
    gain: number,
  ): void {
    const ctx = this.context;
    const bus = this.sfxBus;
    if (!ctx || !bus) return;

    for (let i = 0; i < semitones.length; i += 1) {
      if (this.voices >= MAX_VOICES) return;
      const osc = ctx.createOscillator();
      osc.type = shape;
      osc.frequency.value = 440 * 2 ** ((semitones[i] as number) / 12);

      const start = at + i * step;
      const envelope = ctx.createGain();
      envelope.gain.setValueAtTime(0.0001, start);
      envelope.gain.exponentialRampToValueAtTime(gain, start + 0.01);
      envelope.gain.exponentialRampToValueAtTime(0.0001, start + step * 2.2);

      osc.connect(envelope);
      envelope.connect(bus);
      this.hold(osc, envelope, start, step * 2.2);
    }
  }

  /**
   * Start a voice, count it, and make sure it is uncounted exactly once.
   *
   * The counting is the whole reason `MAX_VOICES` means anything: a node that
   * started without being counted, or one that ended without being uncounted,
   * would leave the ceiling either useless or permanently closed.
   */
  private hold(osc: OscillatorNode, envelope: GainNode, at: number, length: number): void {
    this.voices += 1;
    osc.start(at);
    osc.stop(at + length + 0.02);
    osc.onended = () => {
      this.voices = Math.max(0, this.voices - 1);
      osc.disconnect();
      envelope.disconnect();
    };
  }
}
