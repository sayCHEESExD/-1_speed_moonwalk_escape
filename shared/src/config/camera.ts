/**
 * Third-person chase camera tuning.
 *
 * Lives in shared config so gameplay can reason about framing without
 * importing the renderer.
 */
export interface CameraConfig {
  /** Distance behind the player at rest, in world units. */
  readonly distance: number;
  /** Height above the player's feet that the camera sits at. */
  readonly height: number;
  /** Height above the feet that the camera looks at - the player's chest. */
  readonly lookAtHeight: number;
  /** Positional smoothing factor per second (higher = snappier). */
  readonly followLerp: number;
  /** Vertical field of view in degrees at rest. */
  readonly fov: number;
  readonly near: number;
  readonly far: number;
  /**
   * Extra distance at full speed.
   *
   * Late game runs at hundreds of units a second, and a fixed camera makes the
   * next gap arrive with no warning. Pulling back is what buys the reaction
   * time the obby needs at those speeds.
   */
  readonly speedDistance: number;
  /** Extra vertical FOV in degrees at full speed, for the sense of rush. */
  readonly speedFov: number;
  /** Speed at which the two allowances above are fully applied. */
  readonly speedReference: number;
  /** How fast the dynamic distance and FOV ease, per second. */
  readonly speedEase: number;
}

/**
 * Framed for the reference art: the player sits at the centre of the shot with
 * the carpet filling the lower third, and the corridor ahead is visible to the
 * next obstacle.
 *
 * Closer than the previous game's mounted framing, deliberately. The moonwalk
 * is read in the FEET and the head snap, and a camera pulled back far enough
 * to frame an animal loses both.
 */
export const CAMERA: CameraConfig = {
  distance: 8.4,
  height: 3.2,
  lookAtHeight: 2.4,
  followLerp: 9,
  fov: 68,
  near: 0.1,
  far: 2200,
  speedDistance: 7.5,
  speedFov: 12,
  speedReference: 140,
  speedEase: 2.2,
};
