import {
  COURSE,
  COURSE_END_Z,
  corridorHalfWidthAt,
  type WorldCollision,
} from '@moonwalk/shared';
import {
  BoxGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  Object3D,
  type BufferGeometry,
  type Material,
  type Vector3,
} from 'three';
import { GUARD, guardSpeedFor } from './guardConfig.js';

/**
 * THE MONSTER: one huge thing, chasing exactly one player.
 *
 * It is CLIENT-LOCAL and it is not on the wire. Every player has their own,
 * simulated on their own machine, and no player is ever shown anybody else's -
 * so player A sees monster A and nothing more, which is precisely the brief.
 *
 * Why local, in full:
 *
 *   - A chaser's position depends on where its target is, so it is STATE
 *     rather than a formula and could not be derived from the clock the way a
 *     disco ball is. Replicating it would mean a per-player entity at twenty
 *     hertz - fifteen of them in a full room - to draw fourteen things every
 *     client is then required to hide.
 *   - Nobody else can be harmed by it. One that misbehaves ends ONE run, its
 *     own player's, and it cannot touch anybody else's position, Wins or Speed
 *     because it has no channel to.
 *   - The catch is not a grant, it is a FORFEIT. All it does is ask the server
 *     to put the player back at the arena - a request any client could already
 *     make - and it costs the asker their entire run. There is nothing here to
 *     cheat FOR, which is what makes trusting the client with it reasonable
 *     rather than merely convenient.
 *
 * NAVIGATION IS DELIBERATELY NOT PHYSICS. It does not fall, it is not
 * simulated by `stepPlayer`, and it has no jump. It FOLLOWS THE COURSE: it
 * walks toward the player along the corridor, samples the floor under itself
 * to climb risers, and STRIDES over any gap it finds rather than dropping into
 * it. A creature four times the player's height stepping across a catwalk gap
 * is exactly what it should look like, and it is also the only version of this
 * that cannot get stuck at the bottom of a pit under the map.
 */
export class Guard {
  /** Add this to the scene. Nothing else needs to touch it. */
  readonly root = new Group();

  private readonly collision: WorldCollision;
  private readonly geometries: BufferGeometry[] = [];
  private readonly materials: Material[] = [];

  /** The node the lumber is written to, so the body's own transform is clean. */
  private readonly body = new Group();

  private x = 0;
  private y = 0;
  private z = 0;
  private yaw = 0;

  /** Seconds of grace left before it starts moving. */
  private grace = GUARD.graceSeconds;

  /** Stride phase, advanced with distance so the legs stay planted. */
  private phase = 0;

  /** Limb pivots, so the swing turns about the shoulder and the hip. */
  private readonly legs: Object3D[] = [];
  private readonly arms: Object3D[] = [];

  /** True once it has caught its player and the catch has not been read. */
  private caught = false;

  /** True while it is actually pursuing, for the on-screen warning. */
  private chasing = false;

  constructor(collision: WorldCollision) {
    this.collision = collision;
    this.build();
    this.root.add(this.body);
  }

  /**
   * True while the monster is actively coming after the player.
   *
   * False in the arena, false while it is parked at the mouth, false during
   * the grace window and false while the player is dead. The warning banner
   * reads exactly this, so what the screen says and what the monster is doing
   * cannot disagree.
   */
  get isChasing(): boolean {
    return this.chasing;
  }

  /**
   * Put the monster back behind its player.
   *
   * Called on every placement. It is not a persistent creature that roams the
   * course - it exists to be behind THIS run, so a new run gets a new starting
   * position and a fresh grace window.
   */
  placeBehind(position: Vector3, yaw: number): void {
    // Behind means back down the course. The player travels +Z, so this is
    // simply short of them - but never further back than its waiting post,
    // because it does not go into the arena. A respawn puts the player AT the
    // arena, so without that clamp every placement would park it in the hub.
    this.x = position.x;
    this.z = Math.max(position.z - GUARD.spawnBehind, this.postZ);
    this.y = this.floorAt(this.x, this.z, COURSE.floorY);
    this.yaw = yaw;
    this.grace = GUARD.graceSeconds;
    this.caught = false;
    this.chasing = false;
    this.phase = 0;
    this.applyTransform();
  }

  /** Z of the waiting post: just past the arch, out on the course. */
  private get postZ(): number {
    return COURSE.lobbyEndZ + GUARD.mouthOffset;
  }

  /**
   * True if the monster has caught its player since this was last asked.
   *
   * CONSUMES the catch, so a caller that asks every frame sends one respawn
   * request per catch rather than one per frame. Returning it rather than
   * acting on it keeps this class free of the network - the same reason the
   * death prediction does not decide a respawn either.
   */
  consumeCatch(): boolean {
    if (!this.caught) return false;
    this.caught = false;
    return true;
  }

  /**
   * Chase.
   *
   * @param target    where the player actually is, this frame
   * @param topSpeed  the player's own current top speed, so it scales with the
   *                  progression curve instead of against it
   * @param stage     1-based stage the player is on, or 0 in the arena
   */
  update(delta: number, target: Vector3, topSpeed: number, stage: number): void {
    const dt = Math.max(0, delta);

    /*
     * THE ARENA IS SAFE, and so is the mouth of the course.
     *
     * While the player is in the hub - or has only just stepped out of it -
     * the monster waits at its post and cannot catch anybody. Everything the
     * player has to stand still for happens in the arena, and a chaser that
     * followed them in would make the one room built for standing still the
     * one room you cannot.
     *
     * The `headStart` half of this is the fix for a real bug: the monster used
     * to wait ON the exit line and begin the instant it was crossed, which put
     * it in front of anybody leaving the arch and killed anybody who paused
     * just outside in about two seconds. Standing still is not supposed to be
     * fatal, so the chase now begins well down the first stage, by which point
     * the player is past it and moving.
     */
    if (target.z <= COURSE.lobbyEndZ + GUARD.headStart) {
      this.wait(dt, target);
      return;
    }

    if (this.grace > 0) {
      this.grace -= dt;
      // Still faces its player while it waits, so the pause reads as the thing
      // watching rather than as the thing being asleep.
      this.chasing = false;
      this.faceToward(target, dt);
      this.applyTransform();
      return;
    }

    this.chasing = true;

    const dx = target.x - this.x;
    const dz = target.z - this.z;
    const distance = Math.hypot(dx, dz);

    if (distance <= GUARD.catchRadius) {
      this.caught = true;
      this.chasing = false;
      return;
    }

    /*
     * Leashing.
     *
     * A player this far ahead has outrun the chase entirely, and a monster
     * trudging half a stage behind them is one nobody will ever see again.
     * Re-placing it keeps the pressure on without ever letting it appear in
     * front of anybody, and it is the backstop that makes "permanently stuck"
     * impossible however odd the geometry gets.
     */
    if (distance > GUARD.leashDistance) {
      this.placeBehind(target, this.yaw);
      return;
    }

    const speed = guardSpeedFor(topSpeed, stage);
    const step = Math.min(speed * dt, distance);
    this.moveTo(this.x + (dx / distance) * step, this.z + (dz / distance) * step, dt);

    // Phase advances with DISTANCE, so the legs stay planted at any speed.
    this.phase += (step / Math.max(1e-3, speed)) * GUARD.strideRate * Math.PI * 2;
    this.faceToward(target, dt);
    this.applyTransform();
  }

  dispose(): void {
    for (const geometry of this.geometries) geometry.dispose();
    for (const material of this.materials) material.dispose();
    this.geometries.length = 0;
    this.materials.length = 0;
    this.root.removeFromParent();
  }

  /**
   * Wait at the post while the player is in the arena or just outside it.
   *
   * It stands OFF the lane, hard against one side, so the carpet out of the
   * arch is never blocked - the other half of the instant-death fix. It keeps
   * facing the player, so it is visibly waiting rather than parked: the player
   * can see the thing that is about to chase them pacing the entrance, which
   * is a better warning than any sign.
   */
  private wait(delta: number, target: Vector3): void {
    this.chasing = false;
    this.caught = false;
    // Held full, so stepping out always buys the same head start.
    this.grace = GUARD.graceSeconds;

    const post = this.postZ;
    const lane = corridorHalfWidthAt(post) * GUARD.waitLaneFraction;
    // The side AWAY from the player, so it is never the thing they walk into.
    const side = target.x >= 0 ? -1 : 1;

    // Eased rather than snapped: something that mirrored the player's strafing
    // exactly would read as a reflection rather than as a creature.
    const alpha = 1 - Math.exp(-2 * delta);
    this.x += (side * lane - this.x) * alpha;
    this.z += (post - this.z) * alpha;
    this.y = this.floorAt(this.x, this.z, this.y);

    // Enough phase to keep it shifting its weight on the spot.
    this.phase += delta * 1.1;
    this.faceToward(target, delta);
    this.applyTransform();
  }

  /**
   * Step to a new spot on the course.
   *
   * Clamped to the corridor the player is in, to the arena's back wall and to
   * the END of the world - so it can never walk out of the map at either end,
   * which is what "disappears because the course geometry ends" was.
   */
  private moveTo(nextX: number, nextZ: number, delta: number): void {
    const z = Math.min(Math.max(nextZ, COURSE.lobbyStartZ + 2), COURSE_END_Z);
    const limit = Math.max(1, corridorHalfWidthAt(z) - 1);
    this.x = Math.min(Math.max(nextX, -limit), limit);
    this.z = z;

    // Eased toward the floor rather than snapped onto it, so a riser is a step
    // up and a gap is a stride across rather than a drop.
    const floor = this.floorAt(this.x, this.z, this.y);
    this.y += (floor - this.y) * (1 - Math.exp(-GUARD.climbRate * delta));
  }

  /**
   * The height the monster should be standing at.
   *
   * NOT a physics query, and deliberately not the player's. Three rules, in
   * order:
   *
   *   1. Whatever solid is under it, sampled with a generous reach so a stride
   *      never misses a platform it is halfway onto.
   *   2. Failing that, the course's own floor - because the thing it is
   *      standing over is a GAP, and it strides across gaps. This is the rule
   *      that stops it sinking into a catwalk pit and getting stuck under the
   *      map for the rest of the run.
   *   3. Never below the course floor, whatever happens.
   */
  private floorAt(x: number, z: number, fromY: number): number {
    // Sampled from a little above its current feet, so it can climb onto a
    // riser it has reached without also being teleported onto a pillar it is
    // merely standing beside.
    const surface = this.collision.surfaceYAt(x, z, Math.max(fromY, COURSE.floorY) + 1.6);
    if (surface !== null) return Math.max(surface, COURSE.floorY);
    return COURSE.floorY;
  }

  private faceToward(target: Vector3, delta: number): void {
    const dx = target.x - this.x;
    const dz = target.z - this.z;
    // Too close to aim from, so hold the heading rather than spinning wildly.
    if (Math.abs(dx) < 1e-3 && Math.abs(dz) < 1e-3) return;

    // `atan2(dx, dz)` points the model's own +Z at the target, which is the
    // direction it is travelling - see `build()` for why +Z is its front.
    const desired = Math.atan2(dx, dz);
    let diff = desired - this.yaw;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    const max = GUARD.turnSpeed * delta;
    this.yaw += Math.abs(diff) <= max ? diff : Math.sign(diff) * max;
  }

  /**
   * Write the transform and the lumber.
   *
   * The stride is written to `body`, never to `root`: one node, one owner, the
   * same rule the player's animator follows.
   */
  private applyTransform(): void {
    this.root.position.set(this.x, this.y, this.z);
    this.root.rotation.y = this.yaw;

    const swing = Math.sin(this.phase);
    this.body.position.y = Math.abs(Math.cos(this.phase)) * GUARD.strideBob;
    this.body.rotation.z = swing * GUARD.strideRoll;

    // Legs alternate; arms counter-swing against them.
    const legL = this.legs[0];
    const legR = this.legs[1];
    if (legL) legL.rotation.x = swing * 0.6;
    if (legR) legR.rotation.x = -swing * 0.6;
    const armL = this.arms[0];
    const armR = this.arms[1];
    if (armL) armL.rotation.x = -swing * 0.5;
    if (armR) armR.rotation.x = swing * 0.5;
  }

  /**
   * The body.
   *
   * Blocky on purpose. It is read as a SILHOUETTE in the dark, at a distance,
   * over a shoulder - so what matters is that it is enormous, hunched and
   * unmistakably coming, and none of that needs a mesh.
   *
   * IT FACES +Z, and every asymmetric part is placed accordingly: the eyes,
   * the brow and the jaw all sit on the +Z face. That is not decoration, it is
   * the contract `faceToward` relies on - `atan2(dx, dz)` aims the model's own
   * +Z at the target, so a face built on -Z makes the whole creature run
   * backwards, which is exactly what it used to do.
   */
  private build(): void {
    const hide = this.material(GUARD.hide);
    const hideDark = this.material(GUARD.hideDark);
    const claw = this.material(GUARD.claw);
    const eye = this.emissive(GUARD.eye);

    const H = GUARD.height;
    const W = GUARD.shoulderWidth;
    const D = GUARD.depth;

    // Hunched torso: a deep slab, widest at the shoulders and pitched forward
    // so it looms over whatever it is reaching for.
    const torso = this.mesh(this.box(W, H * 0.34, D), hide, 0, H * 0.6, 0);
    torso.rotation.x = -0.16;
    this.body.add(torso);

    // A hump of shoulder above the torso line, which is most of what makes the
    // silhouette read as a creature rather than a large man.
    this.body.add(this.mesh(this.box(W * 0.86, H * 0.13, D * 0.86), hideDark, 0, H * 0.78, D * 0.06));

    // Narrow hips, so the mass is all up top.
    this.body.add(this.mesh(this.box(W * 0.56, H * 0.12, D * 0.76), hideDark, 0, H * 0.4, 0));

    // Head, slung FORWARD of the shoulders on a short thick neck.
    const headY = H * 0.8;
    const headZ = D * 0.44;
    this.body.add(this.mesh(this.box(W * 0.3, H * 0.09, D * 0.34), hideDark, 0, H * 0.76, D * 0.24));
    this.body.add(this.mesh(this.box(W * 0.46, H * 0.13, D * 0.62), hide, 0, headY, headZ));

    // The jaw, jutting out below the face.
    this.body.add(
      this.mesh(this.box(W * 0.34, H * 0.05, D * 0.3), hideDark, 0, headY - H * 0.06, headZ + D * 0.18),
    );

    /*
     * Two eyes on the FRONT face, and a heavy brow over them.
     *
     * The eyes are the only bright thing on the whole creature, which is the
     * entire point of it: this is a black shape in a black city, and what the
     * player actually tracks over their shoulder is two pink lights getting
     * bigger. They are deliberately OVERSIZED - at a hundred units a
     * realistically-proportioned eye is a single pixel and the monster reads
     * as an unlit blob.
     */
    for (const side of [-1, 1]) {
      this.body.add(
        this.mesh(
          this.box(W * 0.17, H * 0.055, D * 0.1),
          eye,
          side * W * 0.12,
          headY + H * 0.005,
          headZ + D * 0.3,
        ),
      );
    }
    this.body.add(
      this.mesh(this.box(W * 0.48, H * 0.035, D * 0.12), hideDark, 0, headY + H * 0.05, headZ + D * 0.26),
    );

    // A lit maw under the jaw, so there is something to read on the body as
    // well as on the head once it is close.
    this.body.add(
      this.mesh(
        this.box(W * 0.24, H * 0.018, D * 0.08),
        eye,
        0,
        headY - H * 0.055,
        headZ + D * 0.32,
      ),
    );

    // Horns, swept back off the brow.
    for (const side of [-1, 1]) {
      const horn = this.mesh(
        this.box(W * 0.07, H * 0.16, W * 0.07),
        claw,
        side * W * 0.17,
        headY + H * 0.08,
        headZ - D * 0.05,
      );
      horn.rotation.x = 0.5;
      horn.rotation.z = side * 0.28;
      this.body.add(horn);
    }

    // Long arms, hung from the shoulders so they swing about the right point
    // and reach well below the hips.
    for (const side of [-1, 1]) {
      const pivot = new Group();
      pivot.position.set(side * (W * 0.5 + 0.5), H * 0.74, 0);
      pivot.add(this.mesh(this.box(W * 0.22, H * 0.42, D * 0.62), hide, 0, -H * 0.21, 0));
      // A fist of claws on the end.
      pivot.add(this.mesh(this.box(W * 0.26, H * 0.08, D * 0.66), claw, 0, -H * 0.44, D * 0.06));
      this.body.add(pivot);
      this.arms.push(pivot);
    }

    // Legs, hung from the hips for the same reason. Short relative to the
    // torso, which is what makes it lumber rather than stride.
    for (const side of [-1, 1]) {
      const pivot = new Group();
      pivot.position.set(side * W * 0.17, H * 0.4, 0);
      pivot.add(this.mesh(this.box(W * 0.26, H * 0.34, D * 0.66), hideDark, 0, -H * 0.17, 0));
      // A splayed foot, forward of the ankle.
      pivot.add(this.mesh(this.box(W * 0.3, H * 0.05, D * 0.8), claw, 0, -H * 0.36, D * 0.12));
      this.body.add(pivot);
      this.legs.push(pivot);
    }
  }

  private mesh(
    geometry: BufferGeometry,
    material: Material,
    x: number,
    y: number,
    z: number,
  ): Mesh {
    const node = new Mesh(geometry, material);
    node.position.set(x, y, z);
    node.castShadow = true;
    return node;
  }

  private box(w: number, h: number, d: number): BufferGeometry {
    const geometry = new BoxGeometry(w, h, d);
    this.geometries.push(geometry);
    return geometry;
  }

  private material(colour: number): Material {
    const material = new MeshLambertMaterial({ color: colour });
    this.materials.push(material);
    return material;
  }

  /**
   * The eyes.
   *
   * Unlit rather than emissive-on-a-lit-material: they must be the same hot
   * pink at two hundred units in the dark as they are up close, and a lit
   * material at that range is at the mercy of whatever the fog is doing.
   */
  private emissive(colour: number): Material {
    const material = new MeshBasicMaterial({ color: colour });
    this.materials.push(material);
    return material;
  }
}
