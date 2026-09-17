import { PlayerAnimationState } from '@moonwalk/shared';
import { Group, Quaternion, Vector3 } from 'three';
import {
  DEATH,
  JUMP,
  MOONWALK,
  POSE_BLEND_RATE,
  TIP_PIVOT_HEIGHT,
} from '../config/animationConfig.js';
import type { AnimationInput } from './AnimationInput.js';
import { MoonwalkCycle } from './MoonwalkCycle.js';
import { PoseBuffer } from './PoseBuffer.js';
import type { PlayerRig } from './rig/PlayerRig.js';

/** The axis the death tip-over turns about: the character's own forward. */
const TIP_AXIS = new Vector3(0, 0, 1);

const clamp = (value: number, min: number, max: number): number =>
  value < min ? min : value > max ? max : value;

/** Smoothstep easing. */
const ease = (t: number): number => t * t * (3 - 2 * t);

/**
 * The player animation controller.
 *
 * A deliberately small state machine, because there are only two animations to
 * run: the MOONWALK on the ground and the JUMP off it. `Idle` is the moonwalk's
 * own pose with the slide taken out of it, and `Dying` is a half-second
 * procedural tip-over. Nothing here is a walk cycle, and nothing here should
 * ever become one.
 *
 * Responsibilities and boundaries:
 *   - It owns visual state ONLY. It never mutates the player's position,
 *     velocity or progression, and the server stays authoritative for gameplay.
 *   - It writes to bones (via `PlayerRig`), to a tip pivot node and to a visual
 *     bob node. It never touches the character's physics root.
 *   - It knows nothing about the moonwalk's backwards FACING. That is one
 *     constant yaw on a node above it (`PLAYER_MODEL_YAW_OFFSET`), so the
 *     animator poses an ordinary forward-facing character and the illusion is
 *     applied once, outside.
 *
 * Blending: every state writes a full pose into a buffer and the output eases
 * toward it, so any two states cross-fade without an authored transition
 * matrix.
 */
export class PlayerAnimator {
  private rig: PlayerRig;
  private readonly tipPivot: Group;
  private readonly visual: Group;

  private readonly moonwalk = new MoonwalkCycle();

  /** Pose the active state wants this frame. */
  private readonly target = new PoseBuffer();
  /** What is actually applied this frame. */
  private readonly output = new PoseBuffer();

  private readonly tipRotation = new Quaternion();

  private state: PlayerAnimationState = PlayerAnimationState.Idle;

  private idleTime = 0;
  /** Seconds since the player left the ground, for the crouch window. */
  private airTime = 0;
  /** Seconds since touchdown, for the landing squash. Negative when spent. */
  private landTime = -1;
  /** Seconds into the tip-over, or -1 when alive. */
  private deathTime = -1;

  private wasGrounded = true;

  constructor(rig: PlayerRig, tipPivot: Group, visual: Group) {
    this.rig = rig;
    this.tipPivot = tipPivot;
    this.visual = visual;

    this.tipPivot.position.y = TIP_PIVOT_HEIGHT;
    this.visual.position.y = -TIP_PIVOT_HEIGHT;
  }

  /** The visual state currently being played. */
  get currentState(): PlayerAnimationState {
    return this.state;
  }

  /** The moonwalk's cycle phase, so audio can put a beat on the heel pops. */
  get cyclePhase(): number {
    return this.moonwalk.currentPhase;
  }

  /**
   * Drive a different skeleton, e.g. when a Bloxity body replaces the bundled
   * one. The pose buffers are cleared so the new body does not inherit a
   * half-blended pose authored for the old one's rest orientation.
   */
  setRig(rig: PlayerRig): void {
    this.rig = rig;
    this.target.reset();
    this.output.reset();
  }

  /** Clear all animation state, e.g. after a server respawn. */
  reset(): void {
    this.state = PlayerAnimationState.Idle;
    this.idleTime = 0;
    this.airTime = 0;
    this.landTime = -1;
    this.deathTime = -1;
    this.wasGrounded = true;
    this.target.reset();
    this.output.reset();
    this.rig.resetToBindPose();
    this.tipPivot.quaternion.identity();
    this.visual.position.y = -TIP_PIVOT_HEIGHT;
  }

  /** Advance one frame and write the result to the skeleton. */
  update(delta: number, input: AnimationInput): void {
    const dt = Math.max(0, delta);

    this.resolveState(dt, input);
    this.writeStatePose(dt, input);
    this.blendAndApply(dt);
  }

  // ---------------------------------------------------------------- state

  private resolveState(delta: number, input: AnimationInput): void {
    if (input.dying) {
      if (this.deathTime < 0) this.deathTime = 0;
      else this.deathTime += delta;
      this.state = PlayerAnimationState.Dying;
      return;
    }
    this.deathTime = -1;

    // Touchdown starts the landing squash, which plays UNDER the moonwalk
    // rather than as a state of its own - so a player who lands still moving
    // is moonwalking again on the very next frame, with a dip in it.
    if (input.landed || (input.grounded && !this.wasGrounded)) this.landTime = 0;
    else if (this.landTime >= 0) this.landTime += delta;
    if (this.landTime > JUMP.landDuration) this.landTime = -1;

    if (input.jumpStarted) this.airTime = 0;
    this.wasGrounded = input.grounded;

    if (!input.grounded) {
      this.airTime += delta;
      this.state = PlayerAnimationState.Jump;
      return;
    }

    this.state =
      input.horizontalSpeed < MOONWALK.idleSpeed
        ? PlayerAnimationState.Idle
        : PlayerAnimationState.Moonwalk;
  }

  // ----------------------------------------------------------------- pose

  private writeStatePose(delta: number, input: AnimationInput): void {
    switch (this.state) {
      case PlayerAnimationState.Dying:
        this.writeDeathPose();
        break;

      case PlayerAnimationState.Jump:
        this.writeJumpPose(input.verticalVelocity);
        break;

      case PlayerAnimationState.Moonwalk:
        this.moonwalk.advance(delta, input.horizontalSpeed);
        this.moonwalk.writePose(this.target, input.horizontalSpeed, input.moveMultiplier);
        this.applyLanding();
        break;

      default:
        this.moonwalk.settleTowardNeutral(delta);
        this.writeIdlePose(delta);
        this.applyLanding();
        break;
    }
  }

  /**
   * Standing.
   *
   * The moonwalk's own held pose - raised hand included - with breathing on
   * top. A separate idle pose would be a third animation, and it would put the
   * gesture hand somewhere different the instant the player stopped.
   */
  private writeIdlePose(delta: number): void {
    this.idleTime += delta;
    const breath = Math.sin(this.idleTime * MOONWALK.breathFrequency * Math.PI * 2);

    this.target.reset();
    this.target.blendInDefinition(MOONWALK.gesture);
    this.target.add('ArmL1', MOONWALK.armSwing.glide * 0.2, 0, -MOONWALK.armSwing.glide * 0.3);
    this.target.add('ArmL2', MOONWALK.armBend);
    this.target.add('Spine1', MOONWALK.lean.glide * 0.4 + breath * MOONWALK.breathAmount);
    this.target.add('Spine2', breath * MOONWALK.breathAmount * 0.5);
    this.target.add('Neck1', -breath * MOONWALK.breathAmount * 0.6);
    this.target.bobY = breath * 0.012;
  }

  /**
   * Off the ground.
   *
   * One pose blended by vertical velocity, plus the crouch at the very start.
   * The gesture hand is held throughout: the character does not stop being
   * himself because he jumped.
   */
  private writeJumpPose(verticalVelocity: number): void {
    // -1 fully falling .. +1 fully rising.
    const t = clamp(verticalVelocity / JUMP.velocityReference, -1, 1);
    const riseWeight = (t + 1) * 0.5;

    this.target.applyDefinition(JUMP.fall, 1 - riseWeight);
    this.target.blendInDefinition(JUMP.rise, riseWeight);
    this.target.blendInDefinition(MOONWALK.gesture);

    // The crouch: a brief dip at the moment of launch, easing out over the
    // window. It is a drop on the VISUAL node, never on the physics root - the
    // jump's height belongs to the simulation.
    const crouch =
      this.airTime < JUMP.crouchDuration
        ? 1 - ease(clamp(this.airTime / JUMP.crouchDuration, 0, 1))
        : 0;
    this.target.bobY = -JUMP.crouchDrop * crouch;
  }

  /** Fold the touchdown squash into whatever ground pose is already written. */
  private applyLanding(): void {
    if (this.landTime < 0) return;
    const depth = 1 - ease(clamp(this.landTime / JUMP.landDuration, 0, 1));
    this.target.blendInDefinition(JUMP.land, depth);
    this.target.bobY -= JUMP.landDrop * depth;
  }

  /** The tip-over. Limbs fling out, the body sinks, and the pivot rolls. */
  private writeDeathPose(): void {
    this.target.reset();
    this.target.add('Spine1', DEATH.pitch * 0.6, 0, DEATH.roll * 0.12);
    this.target.add('Spine2', DEATH.pitch * 0.3, 0, DEATH.roll * 0.08);
    this.target.add('Neck1', -DEATH.pitch * 0.4, 0, 0);
    this.target.add('ArmL1', -DEATH.splay * 1.4, 0, -DEATH.splay);
    this.target.add('ArmR1', -DEATH.splay * 1.2, 0, DEATH.splay);
    this.target.add('LegL1', -DEATH.splay * 0.5, DEATH.splay * 0.4, 0);
    this.target.add('LegR1', -DEATH.splay * 0.3, -DEATH.splay * 0.4, 0);
    this.target.bobY = -DEATH.drop * this.deathProgress();
  }

  private deathProgress(): number {
    if (this.deathTime < 0) return 0;
    return clamp(this.deathTime / DEATH.duration, 0, 1);
  }

  // ---------------------------------------------------------------- apply

  private blendAndApply(delta: number): void {
    // Eased rather than snapped, so a landing or a death arrives as a movement
    // rather than as a cut. Frame-rate independent, so the blend takes the same
    // wall-clock time at 30fps and at 144.
    const alpha = 1 - Math.exp(-POSE_BLEND_RATE * delta);
    this.output.lerpBetween(this.output, this.target, alpha);

    this.rig.applyPose(this.output);

    // Rebuilt from a scalar every frame rather than accumulated, so repeated
    // deaths cannot drift the pivot.
    this.tipPivot.quaternion.setFromAxisAngle(TIP_AXIS, DEATH.roll * this.deathProgress());

    // Bob is purely visual: it moves the model inside the pivot, never the
    // character root that carries the physics position.
    this.visual.position.y = -TIP_PIVOT_HEIGHT + this.output.bobY;
  }
}
