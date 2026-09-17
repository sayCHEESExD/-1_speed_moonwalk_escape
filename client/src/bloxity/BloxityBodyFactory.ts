import { PLAYER_HEIGHT, isEquippedId, type AvatarItems } from '@moonwalk/shared';
import {
  Mesh,
  MeshStandardMaterial,
  SkinnedMesh,
  type BufferAttribute,
  type BufferGeometry,
  type Object3D,
} from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as cloneSkeleton } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { logger } from '../util/logger.js';
import {
  BLOXITY_MODEL_HEIGHT,
  PART_MESH_NAMES,
  PLAYER_GLB_URL,
  pairedPartUrl,
  partUrl,
} from './bloxityAssets.js';

const SCOPE = 'bloxity/body';

/**
 * Builds a character body out of a player's Bloxity avatar.
 *
 * Used for EVERY player in the room, not just the local one: a look is
 * replicated, so a remote character is dressed by this same factory from the
 * same caches. Fifteen players wearing the default body cost one download.
 *
 * The body is Bloxity's `player.glb`, and body PARTS are geometry swapped onto
 * its skeleton by mesh name - which is how the reference page's viewer does it,
 * and the only way it can be done, because a part is a skinned mesh authored
 * against that one shared rig.
 *
 * What makes this safe here is that the GLB's rig carries the same twelve bone
 * names `PlayerRig` binds, so the moonwalk and the jump drive a Bloxity body
 * without knowing it is one. Nothing in this file animates.
 *
 * Everything is cached by URL, so rebuilding for a hat-and-skin change costs
 * no network at all.
 */
export class BloxityBodyFactory {
  private prototype: Promise<Object3D | null> | null = null;
  private readonly parts = new Map<string, Promise<BufferGeometry | null>>();

  private loadPrototype(): Promise<Object3D | null> {
    this.prototype ??= new GLTFLoader()
      .loadAsync(PLAYER_GLB_URL)
      .then((gltf) => {
        const root = gltf.scene;
        // Remembered so proportions can scale RELATIVE to it later.
        const scale = PLAYER_HEIGHT / BLOXITY_MODEL_HEIGHT;
        root.scale.setScalar(scale);
        root.userData['baseScale'] = scale;
        root.updateMatrixWorld(true);
        return root;
      })
      .catch((error: unknown) => {
        logger.warn(SCOPE, `base body failed to load: ${String(error)}`);
        return null;
      });
    return this.prototype;
  }

  /**
   * A body wearing these parts, or null if the base body cannot be had.
   *
   * Null is the fallback path, not an error: the caller keeps the bundled
   * `player.fbx`, which is what should happen when Bloxity is blocked or down.
   */
  async build(items: AvatarItems): Promise<Object3D | null> {
    const prototype = await this.loadPrototype();
    if (!prototype) return null;

    const body = cloneSkeleton(prototype);
    body.userData['baseScale'] = prototype.userData['baseScale'];
    // Marks a body whose material is its OWN and may be disposed on a swap.
    body.userData['bloxityBody'] = true;

    // One material for the whole body: the skin is a single atlas covering
    // every part. `BloxityAvatar` owns its map.
    const material = new MeshStandardMaterial({ metalness: 0, roughness: 1 });
    const skinned: SkinnedMesh[] = [];
    body.traverse((child) => {
      if (child instanceof SkinnedMesh) {
        child.material = material;
        child.castShadow = true;
        child.frustumCulled = false;
        skinned.push(child);
      } else if (child instanceof Mesh) {
        child.material = material;
        child.castShadow = true;
      }
    });

    await this.wearParts(items, skinned);
    return body;
  }

  private async wearParts(items: AvatarItems, skinned: readonly SkinnedMesh[]): Promise<void> {
    const jobs: { url: string; mesh: string }[] = [];
    if (isEquippedId(items.head)) {
      jobs.push({ url: partUrl('head', items.head), mesh: PART_MESH_NAMES.head });
    }
    if (isEquippedId(items.torso)) {
      jobs.push({ url: partUrl('torso', items.torso), mesh: PART_MESH_NAMES.torso });
    }
    // Each limb slot has its own id, and each is loaded from its own side's file.
    if (isEquippedId(items.armL)) {
      jobs.push({ url: pairedPartUrl('arms', items.armL, 'L'), mesh: PART_MESH_NAMES.arm_L });
    }
    if (isEquippedId(items.armR)) {
      jobs.push({ url: pairedPartUrl('arms', items.armR, 'R'), mesh: PART_MESH_NAMES.arm_R });
    }
    if (isEquippedId(items.legL)) {
      jobs.push({ url: pairedPartUrl('legs', items.legL, 'L'), mesh: PART_MESH_NAMES.leg_L });
    }
    if (isEquippedId(items.legR)) {
      jobs.push({ url: pairedPartUrl('legs', items.legR, 'R'), mesh: PART_MESH_NAMES.leg_R });
    }

    await Promise.all(
      jobs.map(async ({ url, mesh }) => {
        const target = skinned.find((candidate) => candidate.name === mesh);
        if (!target) {
          logger.warn(SCOPE, `base body has no mesh named ${mesh}`);
          return;
        }
        const geometry = await this.loadPart(url, target);
        if (geometry) target.geometry = geometry;
      }),
    );
  }

  /**
   * Load one part and retarget its skinning onto the base skeleton.
   *
   * A part GLB ships its own copy of the rig, so its `skinIndex` values index
   * ITS joint list, which is ordered differently from the body's. Indices are
   * translated through the bone NAME, the one thing both files agree on;
   * copying the geometry across untouched attaches a forearm to whichever bone
   * happens to share its slot number.
   */
  private loadPart(url: string, target: SkinnedMesh): Promise<BufferGeometry | null> {
    const cached = this.parts.get(url);
    if (cached) return cached;

    const request = new GLTFLoader()
      .loadAsync(url)
      .then((gltf) => {
        let source: SkinnedMesh | null = null;
        gltf.scene.traverse((child) => {
          if (!source && child instanceof SkinnedMesh) source = child;
        });
        return source ? retarget(source, target) : null;
      })
      .catch((error: unknown) => {
        logger.warn(SCOPE, `part ${url} failed to load: ${String(error)}`);
        return null;
      });

    this.parts.set(url, request);
    return request;
  }
}

const retarget = (source: SkinnedMesh, target: SkinnedMesh): BufferGeometry => {
  const geometry = source.geometry.clone();
  const attribute = geometry.getAttribute('skinIndex') as BufferAttribute | undefined;
  if (!attribute) return geometry;

  const byName = new Map<string, number>();
  target.skeleton.bones.forEach((bone, index) => {
    if (!byName.has(bone.name)) byName.set(bone.name, index);
  });
  const translation = new Map<number, number>();
  source.skeleton.bones.forEach((bone, index) => {
    const mapped = byName.get(bone.name);
    if (mapped !== undefined) translation.set(index, mapped);
  });

  const array = attribute.array as unknown as { length: number; [index: number]: number };
  for (let i = 0; i < array.length; i += 1) {
    const mapped = translation.get(array[i] as number);
    if (mapped !== undefined) array[i] = mapped;
  }
  attribute.needsUpdate = true;
  return geometry;
};

/** One factory for the client, so its caches are shared. */
export const bloxityBodyFactory = new BloxityBodyFactory();
