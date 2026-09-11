import type { Vec3 } from '../types/math.js';

/**
 * World-space constants shared by the renderer and the authoritative server.
 *
 * Units are "world units" (1 unit ~= 1 Roblox stud in feel). The supplied
 * player.fbx is authored at 320 units tall, so it is scaled down on load.
 */

/** Multiplier applied to the loaded FBX so the character is PLAYER_HEIGHT tall. */
export const FBX_TO_WORLD_SCALE = 0.01;

/** Player height in world units (320 * FBX_TO_WORLD_SCALE). */
export const PLAYER_HEIGHT = 3.2;

/**
 * Height of the collision body, feet to crown.
 *
 * The player is on FOOT in this game - there is no mount - so the simulation's
 * body is the person, and `motion.y` is the sole of their shoe.
 */
export const BODY_HEIGHT = PLAYER_HEIGHT;

/**
 * Horizontal half-width of the collision body.
 *
 * A cylinder rather than a box because the character turns: modelling a
 * rotating box against an axis-aligned course is a solver, not a radius.
 */
export const BODY_RADIUS = 0.72;

/** The course runs along +Z. Players travel *along* it, never across it. */
export const COURSE_FORWARD_AXIS = 'z' as const;

/**
 * Spawn transform: the head of the red carpet in the arena.
 *
 * Deliberately clear of both feature areas - the treadmills down the player's
 * LEFT wall and the upgrade tiles down their RIGHT - so the game opens on the
 * carpet itself, with the VIP arch ahead and both features in shot.
 */
export const SPAWN_POSITION: Readonly<Vec3> = { x: 0, y: 0, z: -62 };

/** Spawn yaw in radians (facing +Z, down the carpet). */
export const SPAWN_ROTATION_Y = 0;

/**
 * Y below which the player has fallen out of the world.
 *
 * Sits well ABOVE the pit floor, so a fall is a short drop into a lit service
 * level the player can see the bottom of rather than a long one into nothing.
 * The world having a visible bottom is what stops a miss reading as a bug.
 */
export const DEATH_PLANE_Y = -11;
