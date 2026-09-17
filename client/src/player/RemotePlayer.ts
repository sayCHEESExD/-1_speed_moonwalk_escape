import { MOVEMENT } from '@moonwalk/shared';
import { DEATH } from '../config/animationConfig.js';
import { createAnimationInput, type AnimationInput } from '../animation/AnimationInput.js';
import { BloxityAvatar } from '../bloxity/BloxityAvatar.js';
import { readAvatarLook } from '../net/readAvatarLook.js';
import type { NetPlayerState } from '../net/netTypes.js';
import { NamePlate } from './NamePlate.js';
import { PlayerCharacter } from './PlayerCharacter.js';

/** Seconds a remote transform is smoothed over. */
const FOLLOW_RATE = 14;

/** Distance past which a remote is placed rather than eased. */
const SNAP_DISTANCE = 12;

const shortestAngle = (from: number, to: number): number => {
  let diff = to - from;
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  return diff;
};

/**
 * Another player.
 *
 * Rendered from replicated state ONLY. Their animation is reconstructed
 * locally by the very same animator the local player runs, driven from the
 * handful of motion fields on the wire - there are no bone transforms in the
 * protocol, and there never should be.
 *
 * Remotes are "ghosted", and that word means exactly one thing: they do not
 * collide, so they can never block another player's run. They render
 * completely normally - opaque, no fade, no ghost material.
 *
 * They are DRESSED and NAMED from replicated state: their Bloxity look and
 * their verified display name are both on the wire, so the player you see is
 * wearing what they chose on bloxity.io and is labelled with the name they
 * chose there. Neither is derived locally and neither is ever an id.
 *
 * They also have no GUARD. Every player is chased by their own, on their own
 * machine, and nobody is ever shown anyone else's - so a remote is a person
 * moonwalking down the carpet for reasons the viewer cannot see, which is
 * exactly the intent.
 */
export class RemotePlayer {
  readonly character = new PlayerCharacter();

  /** Their Bloxity cosmetics. The same class that dresses the local player. */
  private readonly avatar = new BloxityAvatar(this.character);
  private readonly plate = new NamePlate(this.character.root);

  /** Latest authoritative transform, eased toward every frame. */
  private targetX = 0;
  private targetY = 0;
  private targetZ = 0;
  private targetYaw = 0;

  private readonly input: AnimationInput = createAnimationInput();

  /** Death counter last seen, so an increase triggers one fall-over. */
  private lastDeathCount = -1;
  /** Seconds into the fall-over, or -1. */
  private deathTime = -1;

  /** Jump counter last seen, so an increase triggers one crouch. */
  private lastJumpCount = -1;

  private placed = false;

  constructor(state: NetPlayerState) {
    this.apply(state);
    this.character.setPosition(this.targetX, this.targetY, this.targetZ);
    this.character.setYaw(this.targetYaw);
    this.placed = true;
    // A remote joining mid-session must not immediately play a death for every
    // one they have ever had: the counter is a LIFETIME total, so it only
    // means anything as a difference against the baseline taken on first
    // sight.
    this.lastDeathCount = state.deathCount;
    this.lastJumpCount = state.jumpCount;
  }

  /** Copy the replicated fields in. Called on every patch for this player. */
  apply(state: NetPlayerState): void {
    // Both of these no-op on an unchanged value, which is every patch but the
    // handful where somebody signs in or changes a hat.
    this.plate.setName(state.displayName);
    this.avatar.apply(readAvatarLook(state.avatar));

    this.targetX = state.x;
    this.targetY = state.y;
    this.targetZ = state.z;
    this.targetYaw = state.rotationY;

    this.input.grounded = state.grounded;
    // A remote on a treadmill reports zero velocity, so the moonwalk cycle is
    // fed the speed they are DANCING at - otherwise they would stand idle on a
    // belt everyone can see is running.
    this.input.horizontalSpeed =
      state.treadmill > 0 ? MOVEMENT.runSpeed * state.moveMultiplier : state.speed;
    this.input.moveMultiplier = state.moveMultiplier;
    this.input.verticalVelocity = state.verticalVelocity;

    // Edges are DERIVED from the replicated counters rather than sent as
    // events: one comparison instead of a stream that could be replayed, lost
    // or arrive out of order.
    this.input.jumpStarted =
      this.lastJumpCount >= 0 && state.jumpCount > this.lastJumpCount;
    this.lastJumpCount = state.jumpCount;

    if (this.lastDeathCount >= 0 && state.deathCount > this.lastDeathCount) {
      this.deathTime = 0;
    }
    this.lastDeathCount = state.deathCount;
  }

  /** Advance interpolation and animation. */
  update(delta: number): void {
    const dt = Math.max(0, delta);

    const position = this.character.root.position;
    const gap = Math.hypot(
      this.targetX - position.x,
      this.targetY - position.y,
      this.targetZ - position.z,
    );

    if (!this.placed || gap > SNAP_DISTANCE) {
      // A respawn or a long stall. Easing across it would drag the character
      // through every metre of course in between.
      position.set(this.targetX, this.targetY, this.targetZ);
      this.character.setYaw(this.targetYaw);
      this.placed = true;
    } else {
      const alpha = 1 - Math.exp(-FOLLOW_RATE * dt);
      position.x += (this.targetX - position.x) * alpha;
      position.y += (this.targetY - position.y) * alpha;
      position.z += (this.targetZ - position.z) * alpha;
      const yaw = this.character.root.rotation.y;
      this.character.setYaw(yaw + shortestAngle(yaw, this.targetYaw) * alpha);
    }

    if (this.deathTime >= 0) {
      this.deathTime += dt;
      if (this.deathTime > DEATH.duration) this.deathTime = -1;
    }
    this.input.dying = this.deathTime >= 0;
    // Landing is derived the same way a jump is: the animator only needs to
    // know it happened, and "was in the air, now is not" is that fact.
    this.input.landed = false;

    this.character.update(dt, this.input);
    // One-shot edges last exactly one frame, so they are cleared after the
    // animator has been given the chance to see them.
    this.input.jumpStarted = false;
  }

  dispose(): void {
    this.plate.dispose();
    this.avatar.dispose();
    this.character.dispose();
  }
}
