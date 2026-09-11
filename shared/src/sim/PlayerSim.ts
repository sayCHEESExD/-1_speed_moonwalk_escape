import { surfaceAt, treadmillAt } from '../config/course.js';
import { MOVEMENT } from '../config/movement.js';
import { BODY_HEIGHT } from '../constants/world.js';
import { SPAWN_POSITION, SPAWN_ROTATION_Y } from '../constants/world.js';
import { rotateTowards } from '../types/math.js';
import type { WorldCollision } from './WorldCollision.js';

/**
 * The authoritative physics step, shared by the server and by client
 * prediction.
 *
 * This is THE movement simulation. The server runs it to own the result and
 * the client runs the identical function to predict ahead of the network, so
 * the two can only ever disagree through inputs, never through different
 * maths. Do not reimplement any part of it anywhere else.
 *
 * What moves is the PLAYER, on foot. There is no vehicle and no passenger:
 * one body, one transform, one set of velocities. The moonwalk is entirely a
 * matter of which way the model is turned to face, and that decision belongs
 * to the animator - nothing in here knows the character is gliding backwards.
 *
 * Deliberately framework-free and allocation-free: plain numbers on a mutable
 * state object, so it runs in Node and in the browser at any tick rate.
 */

/** Everything that makes up a player's physical state. */
export interface PlayerMotion {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  yaw: number;
  grounded: boolean;
  /** Edge-detect for the jump control, so holding it does not re-fire. */
  jumpLatched: boolean;
  /** Monotonic count of jumps started, replicated so remotes can mirror them. */
  jumpCount: number;
  /**
   * Treadmill the player is standing on, or 0.
   *
   * DERIVED from position every step by both sides, never sent. Walking on
   * starts it and walking off stops it, so there is no message to forge and
   * nothing to keep after stepping off. It changes no physics at all - it only
   * tells the Speed service to bill the belt instead of the ground, and the
   * animator to run on the spot.
   */
  treadmill: number;
  /**
   * Seconds of coyote time left.
   *
   * A player who runs off the lip of a plank at three hundred units a second
   * has left the ground before the player could possibly have reacted. This is
   * the grace window in which the jump still counts, and it is part of the
   * SIMULATION rather than the input layer so the server grants exactly the
   * same window the client predicted.
   */
  coyote: number;
}

/** One frame of player intent. Carries no position - only what was pressed. */
export interface MovementInput {
  /** -1..1, camera-relative. */
  moveX: number;
  /** -1..1, camera-relative. */
  moveZ: number;
  jump: boolean;
  sprint: boolean;
  /** Yaw the camera faced, so movement can be camera-relative. */
  cameraYaw: number;
}

/** Server-owned tuning the step reads but never changes. */
export interface SimParams {
  /** Authoritative movement multiplier from level, rebirths and the owned tier. */
  moveMultiplier: number;
  /** Authoritative jump velocity, resolved by the one shared formula. */
  jumpVelocity: number;
  /**
   * The world clock, in seconds.
   *
   * The disco balls are pure functions of it, so the
   * step has to know WHEN it is happening as well as what was pressed. The
   * server passes its own elapsed time; the client passes its estimate of the
   * same, and is corrected if it guessed wrong.
   */
  time: number;
}

/** Edges this step produced, consumed by the animator. */
export interface SimEvents {
  jumpStarted: boolean;
  landed: boolean;
}

/** Largest single step the simulation will take, in seconds. */
export const MAX_SIM_DELTA = 0.1;

/** Seconds after leaving the ground during which a jump still counts. */
const COYOTE_TIME = 0.11;

export const createMotion = (): PlayerMotion => ({
  x: SPAWN_POSITION.x,
  y: SPAWN_POSITION.y,
  z: SPAWN_POSITION.z,
  vx: 0,
  vy: 0,
  vz: 0,
  yaw: SPAWN_ROTATION_Y,
  grounded: true,
  jumpLatched: false,
  jumpCount: 0,
  treadmill: 0,
  coyote: 0,
});

export const createSimEvents = (): SimEvents => ({
  jumpStarted: false,
  landed: false,
});

export const createMovementInput = (): MovementInput => ({
  moveX: 0,
  moveZ: 0,
  jump: false,
  sprint: false,
  cameraYaw: 0,
});

/** Copy motion state, e.g. when snapping prediction to the server. */
export const copyMotion = (from: PlayerMotion, to: PlayerMotion): void => {
  to.x = from.x;
  to.y = from.y;
  to.z = from.z;
  to.vx = from.vx;
  to.vy = from.vy;
  to.vz = from.vz;
  to.yaw = from.yaw;
  to.grounded = from.grounded;
  to.jumpLatched = from.jumpLatched;
  to.jumpCount = from.jumpCount;
  to.treadmill = from.treadmill;
  to.coyote = from.coyote;
};

/** Reset to a spawn transform. Used by both sides on respawn. */
export const resetMotion = (
  motion: PlayerMotion,
  x = SPAWN_POSITION.x,
  y = SPAWN_POSITION.y,
  z = SPAWN_POSITION.z,
  yaw = SPAWN_ROTATION_Y,
): void => {
  motion.x = x;
  motion.y = y;
  motion.z = z;
  motion.vx = 0;
  motion.vy = 0;
  motion.vz = 0;
  motion.yaw = yaw;
  motion.grounded = true;
  motion.jumpLatched = false;
  motion.treadmill = 0;
  motion.coyote = 0;
};

export const horizontalSpeed = (motion: PlayerMotion): number =>
  Math.hypot(motion.vx, motion.vz);

/**
 * Sanitise one input before it is simulated.
 *
 * Applied on the SERVER to every arriving input: a client may send whatever it
 * likes, but the stick is clamped to the unit disc and every field is forced
 * finite, so an out-of-range or NaN input cannot become out-of-range movement.
 */
export const sanitiseInput = (
  input: Partial<MovementInput> | undefined,
): MovementInput => {
  const finite = (value: unknown): number =>
    typeof value === 'number' && Number.isFinite(value) ? value : 0;

  let moveX = finite(input?.moveX);
  let moveZ = finite(input?.moveZ);
  const magnitude = Math.hypot(moveX, moveZ);
  if (magnitude > 1) {
    moveX /= magnitude;
    moveZ /= magnitude;
  }

  return {
    moveX,
    moveZ,
    jump: input?.jump === true,
    sprint: input?.sprint === true,
    cameraYaw: finite(input?.cameraYaw),
  };
};

/** Scratch for the boundary clamp. Single-threaded, so sharing is safe. */
const BOUNDS = { x: 0, z: 0 };

/**
 * Advance one player by one step.
 *
 * @param motion    mutated in place
 * @param input     already sanitised intent
 * @param params    server-owned tuning
 * @param delta     seconds; clamped internally to [0, MAX_SIM_DELTA]
 * @param collision the course the player moves through
 * @param events    mutated in place with the edges this step produced
 */
export const stepPlayer = (
  motion: PlayerMotion,
  input: MovementInput,
  params: SimParams,
  delta: number,
  collision: WorldCollision,
  events: SimEvents,
): void => {
  events.jumpStarted = false;
  events.landed = false;

  const dt = Number.isFinite(delta) ? Math.min(Math.max(delta, 0), MAX_SIM_DELTA) : 0;
  if (dt === 0) return;

  // ONE instant for the whole step, including every substep and every replayed
  // step during reconciliation. A ball that moved between two substeps of
  // the same frame would make the world disagree with itself.
  collision.setTime(params.time);

  const wasGrounded = motion.grounded;

  applyActions(motion, input, params, events);
  applyHorizontal(motion, input, params, dt);
  motion.vy -= MOVEMENT.gravity * dt;

  // SUBSTEPPING is what removes the speed cap.
  //
  // Late game moves at hundreds of units a second. Integrating that in one
  // 1/60s step would displace the player five metres at once, straight through
  // a plank, a pillar and the gap past it - so the old answer was always to
  // cap the speed. Instead the step is subdivided until no substep travels
  // further than `maxSubstepDistance`, which makes collision exactly as
  // reliable at 400 u/s as at 20 and lets the progression curve run as far as
  // it likes.
  const travel = Math.hypot(motion.vx, motion.vy, motion.vz) * dt;
  const substeps = Math.max(
    1,
    Math.min(Math.ceil(travel / MOVEMENT.maxSubstepDistance), MOVEMENT.maxSubsteps),
  );
  const sub = dt / substeps;

  for (let i = 0; i < substeps; i += 1) {
    integrate(motion, sub, collision);
  }

  // Coyote time is spent by wall-clock, not by substep, so it is the same
  // window however fast the player is moving.
  if (motion.grounded) motion.coyote = COYOTE_TIME;
  else motion.coyote = Math.max(0, motion.coyote - dt);

  // Derived last, from the position this step actually reached.
  motion.treadmill = motion.grounded ? treadmillAt(motion.x, motion.y, motion.z) : 0;

  if (!wasGrounded && motion.grounded) events.landed = true;
};

/**
 * One substep: move, then resolve, one axis at a time.
 *
 * Axis-separated resolution is exact for an axis-aligned course and cannot
 * oscillate, which a combined push-out can. The vertical pass runs last so the
 * ground test sees the horizontally-corrected position rather than one that is
 * still inside a pillar.
 */
const integrate = (motion: PlayerMotion, dt: number, collision: WorldCollision): void => {
  const previousY = motion.y;

  motion.x += motion.vx * dt;
  const correctedX = collision.resolveAxis(0, motion.x, motion.z, motion.y);
  if (correctedX !== motion.x) {
    motion.x = correctedX;
    // Kill only the component that hit the wall, so the player slides along it
    // instead of stopping dead against every pillar.
    motion.vx = 0;
  }

  motion.z += motion.vz * dt;
  const correctedZ = collision.resolveAxis(2, motion.z, motion.x, motion.y);
  if (correctedZ !== motion.z) {
    motion.z = correctedZ;
    motion.vz = 0;
  }

  motion.y += motion.vy * dt;

  collision.clampToBounds(motion.x, motion.z, BOUNDS);
  motion.x = BOUNDS.x;
  motion.z = BOUNDS.z;

  resolveCeiling(motion, previousY, collision);
  resolveGround(motion, previousY, collision);
};

/**
 * Jump.
 *
 * The decision is made from the SIMULATION's own state, so a client cannot
 * jump in mid-air no matter what it sends - the worst it can do is predict a
 * jump the server refuses and be corrected.
 */
const applyActions = (
  motion: PlayerMotion,
  input: MovementInput,
  params: SimParams,
  events: SimEvents,
): void => {
  const pressed = input.jump && !motion.jumpLatched;
  motion.jumpLatched = input.jump;
  if (!pressed) return;
  if (!motion.grounded && motion.coyote <= 0) return;

  motion.vy = params.jumpVelocity;
  motion.grounded = false;
  motion.coyote = 0;
  motion.jumpCount += 1;
  events.jumpStarted = true;
};

const applyHorizontal = (
  motion: PlayerMotion,
  input: MovementInput,
  params: SimParams,
  dt: number,
): void => {
  const hasInput = input.moveX !== 0 || input.moveZ !== 0;

  // Rotate the raw stick into world space using the camera's yaw.
  //
  // The camera looks along (sin, cos); its RIGHT is (-cos, sin), because with
  // Y up and X to the right of screen, +Z runs away from the viewer. Getting
  // this backwards inverts strafing, and a camera that trailed the player's
  // own facing would hide it completely - which is exactly why the camera owns
  // its yaw here and movement is resolved against it.
  const sin = Math.sin(input.cameraYaw);
  const cos = Math.cos(input.cameraYaw);
  const dirX = input.moveZ * sin - input.moveX * cos;
  const dirZ = input.moveZ * cos + input.moveX * sin;

  const base = input.sprint ? MOVEMENT.runSpeed : MOVEMENT.walkSpeed;
  const targetSpeed = base * params.moveMultiplier;
  const control = motion.grounded ? 1 : MOVEMENT.airControl;

  /*
   * The ground the player is over, if it is anything other than ordinary.
   *
   * Read HERE, inside the shared step, rather than applied as a force by
   * either side separately: ice and wind change how the controls answer, and a
   * client whose prediction handled differently from the server's simulation
   * would spend the whole stage being pulled back to a position it did not
   * steer to. There is one formula and both sides run it.
   */
  const surface = surfaceAt(motion.x, motion.z);

  // Grip scales acceleration and braking TOGETHER. Lowering only the braking
  // would make a slick floor a place where the player is harder to stop; lowering both is
  // what makes it a place where it is harder to steer, which is the mechanic.
  const grip = surface && motion.grounded ? Math.max(0.05, surface.grip) : 1;

  // Wind acts in the air as well as on the ground - a jump in a crosswind that
  // went exactly where it was aimed would make the whole stage cosmetic.
  if (surface) {
    motion.vx += surface.windX * dt;
    motion.vz += surface.windZ * dt;
  }

  if (hasInput) {
    // Acceleration scales with the target speed, so reaching top speed takes
    // about the same time at every level. A fixed acceleration would leave a
    // level-80 player spending several seconds winding up.
    const accel = MOVEMENT.acceleration * params.moveMultiplier * control * grip * dt;
    const rate = Math.min(accel / targetSpeed, 1);
    motion.vx += (dirX * targetSpeed - motion.vx) * rate;
    motion.vz += (dirZ * targetSpeed - motion.vz) * rate;

    const desiredYaw = Math.atan2(dirX, dirZ);
    motion.yaw = rotateTowards(motion.yaw, desiredYaw, MOVEMENT.turnSpeed * dt);
  } else if (motion.grounded) {
    const drop = MOVEMENT.deceleration * params.moveMultiplier * grip * dt;
    const speed = horizontalSpeed(motion);
    // The speed guard matters independently of `drop`: dividing by a zero
    // speed would yield Infinity, and 0 * Infinity is NaN.
    if (speed <= drop || speed < 1e-6) {
      motion.vx = 0;
      motion.vz = 0;
    } else {
      const scale = (speed - drop) / speed;
      motion.vx *= scale;
      motion.vz *= scale;
    }
  }
};

/**
 * Stop a rising player at the underside of whatever is above it.
 *
 * Runs BEFORE the ground test, because a player pushed down out of a ceiling
 * may immediately be standing on something and the ground test should see the
 * corrected height rather than one that is still inside a slab.
 */
const resolveCeiling = (
  motion: PlayerMotion,
  previousY: number,
  collision: WorldCollision,
): void => {
  if (motion.vy <= 0) return;

  const ceiling = collision.ceilingYAt(motion.x, motion.z, previousY + BODY_HEIGHT);
  if (ceiling === null) return;
  if (motion.y + BODY_HEIGHT <= ceiling) return;

  motion.y = ceiling - BODY_HEIGHT;
  // The climb stops dead; horizontal travel is untouched, so a player who
  // clips a corner slides out from under it rather than being halted.
  motion.vy = 0;
};

/**
 * Land on whatever is under the player, or keep falling.
 *
 * Leaving the ground by ANY means - jumping, running off a plank - must clear
 * `grounded`, or the fall animation never plays and a second jump stays
 * available in mid-air.
 */
const resolveGround = (
  motion: PlayerMotion,
  previousY: number,
  collision: WorldCollision,
): void => {
  const surfaceY = collision.surfaceYAt(motion.x, motion.z, previousY);

  if (surfaceY === null || motion.vy > 0 || motion.y > surfaceY) {
    motion.grounded = false;
    return;
  }

  // Only land when arriving from above; a player who has already dropped past
  // a plank must not be snapped back up onto it.
  if (!collision.canLandOn(previousY, surfaceY)) {
    motion.grounded = false;
    return;
  }

  motion.y = surfaceY;
  motion.vy = 0;
  motion.grounded = true;
};
