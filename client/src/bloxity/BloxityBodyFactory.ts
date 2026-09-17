import { PLAYER_HEIGHT, type AvatarItems } from '@moonwalk/shared';
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
  PART_TARGETS,
  PLAYER_GLB_URL,
  assetUrl,
  describeItem,
  type BloxityItem,
} from './bloxityAssets.js';

const SCOPE = 'bloxity/body';

/**
 * Builds a character body out of a player's Bloxity avatar.
 *
 * The body is Bloxity's `player.glb`, and body PARTS are geometry swapped onto
 * its skeleton by mesh name - which is how Bloxity's own renderer does it, and
 * the only way it can be done, because a part is a skinned mesh authored
 * against that one shared rig.
 *
 * What makes this safe here is that the GLB's rig carries the same twelve bone
 * names `PlayerRig` binds, so the moonwalk and the jump drive a Bloxity body
 * without knowing it is one. Nothing in this file animates.
 *
 * Used for EVERY player, local and remote, so there is ONE construction path
 * and nobody can look different on their own screen to how they look on
 * everybody else's. Everything is cached by URL, so fifteen players in the
 * same body cost one download.
 */
export class BloxityBodyFactory {
  private prototype: Promise<Object3D | null> | null = null;

  /**
   * Remapped part geometry, by asset URL.
   *
   * Shareable between bodies because the remap targets the PROTOTYPE's bone
   * order and every body is a clone of that one prototype.
   */
  private readonly parts = new Map<string, Promise<BufferGeometry | null>>();

  private loadPrototype(): Promise<Object3D | null> {
    this.prototype ??= new GLTFLoader()
      .loadAsync(PLAYER_GLB_URL)
      .then((gltf) => {
        const root = gltf.scene;
        /*
         * Sized to this game's character, ONCE and uniformly.
         *
         * The GLB stands 6.4 units tall and a player here is 3.2. This is the
         * only place the body's own scale is set; the height proportion is a
         * multiplier applied on top of `baseScale` by `BloxityAvatar`, which
         * is what stops the two becoming a double scaling.
         */
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
   * A part that is missing from the catalogue falls back ON ITS OWN - the
   * default mesh for that slot stays - so one bad id costs an arm, never a
   * whole avatar.
   */
  async build(items: AvatarItems): Promise<Object3D | null> {
    const prototype = await this.loadPrototype();
    if (!prototype) return null;

    const body = cloneSkeleton(prototype);
    body.userData['baseScale'] = prototype.userData['baseScale'];
    // Marks a body whose material is its OWN and may be disposed on a swap.
    body.userData['bloxityBody'] = true;

    // One material for the whole body, as Bloxity's renderer uses: the skin is
    // a single atlas covering every part. `BloxityAvatar` owns its map.
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

  /**
   * Swap in every equipped body part, in parallel.
   *
   * Arms and legs are ONE catalogue item carrying two meshes, which is the
   * thing the id-pattern version of this file got wrong: it asked for
   * `{id}_L.glb` and `{id}_R.glb` per side and got 404s for every item whose
   * files are not named that way. One id, one lookup, both meshes.
   */
  private async wearParts(items: AvatarItems, skinned: readonly SkinnedMesh[]): Promise<void> {
    const wanted: Array<{ id: string; slot: NonNullable<BloxityItem['partSlot']> }> = [];
    if (items.head) wanted.push({ id: items.head, slot: 'head' });
    if (items.torso) wanted.push({ id: items.torso, slot: 'torso' });
    const arms = items.armL || items.armR;
    if (arms) wanted.push({ id: arms, slot: 'arms' });
    const legs = items.legL || items.legR;
    if (legs) wanted.push({ id: legs, slot: 'legs' });

    await Promise.all(
      wanted.map(async ({ id, slot }) => {
        const item = await describeItem(id);
        if (!item?.assetPaths) {
          logger.warn(SCOPE, `part ${id} is not in the catalogue - keeping the default ${slot}`);
          return;
        }

        await Promise.all(
          PART_TARGETS[slot].map(async (target) => {
            const path = item.assetPaths?.[target.path];
            if (!path) return;

            const mesh = skinned.find((candidate) => candidate.name === target.mesh);
            if (!mesh) {
              logger.warn(SCOPE, `base body has no mesh named ${target.mesh}`);
              return;
            }

            const geometry = await this.loadPart(assetUrl(path), mesh);
            if (geometry) mesh.geometry = geometry;
          }),
        );
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
