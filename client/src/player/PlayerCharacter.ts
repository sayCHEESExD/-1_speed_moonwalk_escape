import type { PlayerAnimationState } from '@moonwalk/shared';
import { Group, Object3D } from 'three';
import type { AnimationInput } from '../animation/AnimationInput.js';
import { PlayerAnimator } from '../animation/PlayerAnimator.js';
import { PlayerRig } from '../animation/rig/PlayerRig.js';
import { PLAYER_MODEL_YAW_OFFSET } from '../config/worldVisuals.js';
import { playerModelLoader } from './PlayerModelLoader.js';

/**
 * The visual half of a player: a cloned FBX instance, its bone rig and its
 * animator, arranged so animation can never move the player.
 *
 * Node hierarchy, and every node has exactly ONE owner:
 *
 *   root         physics transform - world position and TRAVEL yaw. Gameplay
 *                owns this; the animator never writes to it.
 *     facing     the moonwalk. A constant half-turn, so the body faces the
 *                opposite way to the travel. Owned by this file and written
 *                once, at construction.
 *       tipPivot raised to hip height, carries the death tip-over so the
 *                character keels over about its own centre of mass.
 *         visual carries the vertical bob.
 *           model  the cloned FBX (scaled), whose bones the rig poses.
 *
 * The `facing` node is the whole moonwalk illusion and it is deliberately its
 * own node rather than a rotation folded into `root` or into `model`. `root` is
 * the authoritative transform the server also computes, so turning it would
 * make the client and the server disagree about which way a player is pointing;
 * `model.rotation.y` is the FBX's own authored orientation, so folding a second
 * meaning into it would leave two unrelated facts sharing one number. One node,
 * one reason.
 */
export class PlayerCharacter {
  /** Attach this to the scene. Its transform is the player transform. */
  readonly root = new Group();

  readonly animator: PlayerAnimator;
  private currentRig: PlayerRig;

  /**
   * The half-turn that makes the glide a moonwalk.
   *
   * Exposed read-only for diagnostics. Nothing should write to it: the
   * character faces backwards at every speed, standing still included, because
   * the moonwalk is the only way this character moves on the ground and a
   * facing that flipped when they stopped would spin them on the spot every
   * time they let go of W.
   */
  private readonly facing = new Group();

  private readonly tipPivot = new Group();
  private readonly visual = new Group();
  /** The bundled `player.fbx` clone, kept so a Bloxity body can be taken off again. */
  private readonly defaultModel: Object3D;
  private model: Object3D;

  constructor() {
    this.defaultModel = playerModelLoader.createInstance();
    this.model = this.defaultModel;

    this.root.add(this.facing);
    this.facing.add(this.tipPivot);
    this.tipPivot.add(this.visual);
    this.visual.add(this.model);

    // THE moonwalk. See `PLAYER_MODEL_YAW_OFFSET` for why this is presentation
    // and not simulation.
    this.facing.rotation.y = PLAYER_MODEL_YAW_OFFSET;

    // Bind against the model's own space so the rig is independent of where
    // the character stands and of the half-turn above it.
    this.currentRig = new PlayerRig(this.model, this.model);
    this.animator = new PlayerAnimator(this.currentRig, this.tipPivot, this.visual);
  }

  get rig(): PlayerRig {
    return this.currentRig;
  }

  /**
   * Wear a different body, or null for the bundled one.
   *
   * The body goes into the SAME `visual` node, under the same moonwalk
   * half-turn, and a fresh rig is bound to it by bone name - Bloxity's
   * `player.glb` carries the twelve names `player.fbx` does, so the moonwalk
   * and the jump drive it unchanged. Nothing above `visual` moves.
   *
   * @returns the model now worn
   */
  setModel(next: Object3D | null): Object3D {
    const target = next ?? this.defaultModel;
    if (target === this.model) return target;

    const previous = this.model;
    previous.removeFromParent();
    if (previous !== this.defaultModel && previous.userData['bloxityBody'] === true) {
      // A Bloxity body owns its material; its part geometry is cached and shared.
      previous.traverse((child) => {
        const material = (child as { material?: { dispose?: () => void } }).material;
        material?.dispose?.();
      });
    }

    this.model = target;
    this.visual.add(target);
    this.currentRig = new PlayerRig(target, target);
    this.animator.setRig(this.currentRig);
    return target;
  }

  /**
   * The cloned FBX itself.
   *
   * Exposed for diagnostics only. Position, facing and animation all have
   * their own accessors above, and nothing else should need to reach in here.
   */
  get modelRoot(): Object3D {
    return this.model;
  }

  setPosition(x: number, y: number, z: number): void {
    this.root.position.set(x, y, z);
  }

  /** The direction of TRAVEL. The body is drawn facing the other way. */
  setYaw(yaw: number): void {
    this.root.rotation.y = yaw;
  }

  /**
   * Scale the character for a presentation effect - the arrival pop and the
   * death squash.
   *
   * Written to the VISUAL node, never to `root`: root is the physics transform
   * gameplay owns, and the same rule that stops the animator moving the player
   * stops this too. The animator writes this node's POSITION (the bob) and
   * never its scale, so the two cannot fight.
   */
  setVisualScale(x: number, y: number, z: number): void {
    this.visual.scale.set(x, y, z);
  }

  /** Advance the animation. Never changes `root`. */
  update(delta: number, input: AnimationInput): void {
    this.animator.update(delta, input);
  }

  get animationState(): PlayerAnimationState {
    return this.animator.currentState;
  }

  /** Clear animation state, e.g. after a server-issued respawn. */
  resetAnimation(): void {
    this.animator.reset();
    this.visual.scale.set(1, 1, 1);
  }

  dispose(): void {
    this.root.removeFromParent();
  }
}
