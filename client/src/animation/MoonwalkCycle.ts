import { MOONWALK } from '../config/animationConfig.js';
import type { PoseBuffer } from './PoseBuffer.js';

const TAU = Math.PI * 2;

const clamp = (value: number, min: number, max: number): number =>
  value < min ? min : value > max ? max : value;

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

/** Smooth 0..1 ramp between two thresholds. */
const smoothstep = (edge0: number, edge1: number, value: number): number => {
  const t = clamp((value - edge0) / (edge1 - edge0 || 1), 0, 1);
  return t * t * (3 - 2 * t);
};

/**
 * THE ground animation: one procedural moonwalk driven by a phase.
 *
 * This is the only locomotion cycle in the game. There is no walk and no run
 * to blend against - `show` is the same moonwalk performed harder, so speeding
 * up deepens the slide, sharpens the head snap and widens the arm rather than
 * handing over to a different move.
 *
 * Phase advances with DISTANCE travelled, not with wall-clock time, so the
 * feet stay planted in step with real movement at any speed.
 *
 * What makes it a moonwalk rather than a walk played backwards is the
 * ASYMMETRY between the legs at every instant:
 *
 *   - the leg that is SLIDING has a straight knee and a flat foot, and travels
 *     backward through the whole of its half-cycle;
 *   - the leg that is RECOVERING has its heel up and its knee folded hard, and
 *     comes forward on the toe.
 *
 * Half a cycle later they swap. Both legs bending the same way, or the knees
 * cycling symmetrically, is exactly what a walk is - so the sign of the knee
 * curve here is the difference between the whole game working and not.
 */
export class MoonwalkCycle {
  private phase = 0;

  /** Current cycle phase in radians, for diagnostics and the audio cadence. */
  get currentPhase(): number {
    return this.phase;
  }

  /**
   * How strongly the showman version is applied, 0..1.
   *
   * Measured against the player's own movement MULTIPLIER rather than a fixed
   * speed: at level 60 a gentle glide is sixty units a second, and a fixed
   * threshold would leave every late-game player permanently at full tilt.
   */
  showBlend(speed: number, moveMultiplier: number): number {
    const scale = Math.max(1, moveMultiplier);
    return smoothstep(MOONWALK.glideSpeed * scale, MOONWALK.showSpeed * scale, speed);
  }

  /** Advance the cycle. Returns the frequency used, in cycles per second. */
  advance(delta: number, speed: number): number {
    const frequency = clamp(
      speed / MOONWALK.strideDistance,
      MOONWALK.minFrequency,
      MOONWALK.maxFrequency,
    );
    this.phase = (this.phase + frequency * TAU * delta) % TAU;
    return frequency;
  }

  /**
   * Ease the cycle back toward a neutral standing phase.
   *
   * Used while idle, so starting to glide never begins mid-slide with one heel
   * already in the air.
   */
  settleTowardNeutral(delta: number): void {
    const target = this.phase > Math.PI ? TAU : 0;
    const alpha = 1 - Math.exp(-8 * delta);
    this.phase += (target - this.phase) * alpha;
    if (this.phase >= TAU - 1e-4) this.phase = 0;
  }

  /** Write the moonwalk pose for the current phase. */
  writePose(out: PoseBuffer, speed: number, moveMultiplier: number): void {
    const show = this.showBlend(speed, moveMultiplier);
    const phase = this.phase;

    const hip = lerp(MOONWALK.hipReach.glide, MOONWALK.hipReach.show, show);
    const knee = lerp(MOONWALK.kneeBend.glide, MOONWALK.kneeBend.show, show);
    const arm = lerp(MOONWALK.armSwing.glide, MOONWALK.armSwing.show, show);
    const lean = lerp(MOONWALK.lean.glide, MOONWALK.lean.show, show);
    const roll = lerp(MOONWALK.roll.glide, MOONWALK.roll.show, show);
    const twist = lerp(MOONWALK.hipTwist.glide, MOONWALK.hipTwist.show, show);
    const snap = lerp(MOONWALK.headSnap.glide, MOONWALK.headSnap.show, show);
    const bob = lerp(MOONWALK.bob.glide, MOONWALK.bob.show, show);

    out.reset();

    // Left leg leads; the right is half a cycle behind it.
    this.writeLeg(out, 'L', phase, hip, knee);
    this.writeLeg(out, 'R', phase + Math.PI, hip, knee);

    /*
     * The head snap.
     *
     * A sine pushed through a steep tanh: the result holds near +1, crosses in
     * a couple of frames, and holds near -1. That hold-flick-hold is the whole
     * character of the move's head, and a plain sine gives a nod instead.
     */
    const drive = Math.sin(phase * MOONWALK.headSnapsPerCycle);
    const snapped = Math.tanh(drive * MOONWALK.headSnapSharpness);
    out.set('Neck1', -lean * 0.5 - MOONWALK.headLift * Math.abs(snapped), snap * snapped, 0);

    // Torso: leaning into the direction the body FACES, which is the opposite
    // of the way it is travelling - that lean is what sells the glide.
    out.set('Spine1', lean, -twist * 0.5, roll * Math.sin(phase));
    out.set('Spine2', lean * 0.35, -twist * 0.25, roll * 0.4 * Math.sin(phase));
    // Hips counter-rotate against the shoulders.
    out.set('Rig1', 0, twist * Math.sin(phase), 0);

    /*
     * The raised right hand: a HELD pose with a pulse, never a swing.
     *
     * It is the silhouette the whole character is recognised by, so it stays
     * put. The pulse is small enough that the hand never leaves the brim.
     */
    out.blendInDefinition(MOONWALK.gesture);
    const pulse = MOONWALK.gesturePulse * Math.sin(phase * 2) * show;
    out.add('ArmR1', pulse, 0, 0);
    out.add('ArmR2', -pulse * 0.6, 0, 0);

    // The free arm swings, counter to the leg on its own side.
    const swing = Math.sin(phase);
    out.set('ArmL1', arm * swing, 0, -arm * 0.35);
    out.set('ArmL2', MOONWALK.armBend + MOONWALK.armBend * 0.4 * Math.max(0, swing));

    // The body rises twice per cycle, once per heel pop. Visual only, and
    // small: a moonwalk that bounces has stopped being a glide.
    out.bobY = -bob * Math.cos(phase * 2);
  }

  /**
   * One leg's contribution.
   *
   * `slide` is +1 with the foot fully forward and -1 with it fully back, so
   * the foot is travelling BACKWARD whenever `sin(phase)` is positive - which
   * is exactly the half of the cycle in which the knee must stay straight.
   */
  private writeLeg(
    out: PoseBuffer,
    side: 'L' | 'R',
    phase: number,
    hip: number,
    knee: number,
  ): void {
    const slide = Math.cos(phase);
    const moving = Math.sin(phase);

    // A forward swing is a NEGATIVE pitch in character space.
    const thigh = -hip * slide;

    /*
     * The heel pop.
     *
     * Only ever on the recovering leg - the one coming forward, where `moving`
     * is negative. `max(0, -moving)` is therefore zero for the whole sliding
     * half, which is what keeps the sliding foot flat on the floor. Squaring
     * it makes the fold snap late rather than easing in, so the heel comes up
     * sharply at the top of the step.
     */
    const recover = Math.max(0, -moving);
    const bend = knee * recover * recover;

    // The sliding leg straightens a touch past neutral - the leg is being
    // pushed into the floor, not merely left alone.
    const straighten = MOONWALK.slideStraighten * Math.max(0, moving);

    out.set(`Leg${side}1`, thigh, 0, 0);
    out.set(`Leg${side}2`, bend - straighten, 0, 0);
  }
}
