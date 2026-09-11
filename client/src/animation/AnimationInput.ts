/**
 * The gameplay signals the animator consumes each frame.
 *
 * This is the whole contract between gameplay and presentation. The animator
 * reads it and never writes back: it cannot move the player, cannot change
 * velocity and cannot decide a gameplay outcome.
 *
 * The identical struct is produced by the local player from its own prediction
 * and by each remote player from replicated network state, so local and remote
 * characters run the exact same animation code.
 */
export interface AnimationInput {
  /** Standing on a surface. */
  grounded: boolean;
  /**
   * Horizontal speed in world units per second.
   *
   * On a treadmill this is the speed the player is MOONWALKING at rather than
   * the speed they are travelling at, which is zero. It is the one place the
   * two differ, and the animator wants the former.
   */
  horizontalSpeed: number;
  /**
   * The player's authoritative movement multiplier.
   *
   * The show blend is measured against it rather than against a fixed speed:
   * at level 60 a gentle glide is sixty units a second, and a fixed threshold
   * would leave every late-game player permanently at full tilt.
   */
  moveMultiplier: number;
  /** Vertical velocity in world units per second; negative is falling. */
  verticalVelocity: number;
  /** True on the frame the player leaves the ground under their own power. */
  jumpStarted: boolean;
  /** True on the frame the player touches down. */
  landed: boolean;
  /** True while the fall-over should play. */
  dying: boolean;
}

export const createAnimationInput = (): AnimationInput => ({
  grounded: true,
  horizontalSpeed: 0,
  moveMultiplier: 1,
  verticalVelocity: 0,
  jumpStarted: false,
  landed: false,
  dying: false,
});
