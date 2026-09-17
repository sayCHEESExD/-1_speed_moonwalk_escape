import {
  BUNDLED_LOOK,
  PLAYER_HEIGHT,
  isEquippedId,
  looksMatch,
  type AvatarItems,
  type AvatarLook,
  type AvatarProportions,
} from '@moonwalk/shared';
import {
  Mesh,
  MeshStandardMaterial,
  NearestFilter,
  SRGBColorSpace,
  TextureLoader,
  Vector3,
  type Bone,
  type Object3D,
  type Texture,
} from 'three';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import type { PlayerCharacter } from '../player/PlayerCharacter.js';
import { logger } from '../util/logger.js';
import { bloxityBodyFactory } from './BloxityBodyFactory.js';
import {
  BLOXITY_MODEL_HEIGHT,
  DEFAULT_SKIN_ID,
  resolveItemUrls,
  resolveSkinUrl,
} from './bloxityAssets.js';


const SCOPE = 'bloxity/avatar';

/** World size of one unit of a Bloxity item, from the GLB's own scale. */
const ITEM_WORLD_SCALE = PLAYER_HEIGHT / BLOXITY_MODEL_HEIGHT;
/** The reference page's hat lift on the head bone, in GLB units. */
const HAT_LIFT = 0.8;
/** How far behind the chest a back item sits on the bundled body, in world units. */
const FBX_BACK_OFFSET = -0.18;

const SCRATCH = new Vector3();

/**
 * Bloxity cosmetics on ONE character - local or remote, identically.
 *
 * Four things, each where it belongs:
 *
 *  - the BODY: `player.glb` with its parts swapped in, worn whenever Bloxity
 *    could describe this player at all. THE DEFAULT AVATAR IS BLOXITY'S, not
 *    ours: a player who never opened the customiser still has a Bloxity
 *    default - that body, wearing `skins/0.png` - and rendering this game's
 *    bundled character for them would be showing them somebody else's. The
 *    bundled body is the fallback for exactly one case: the SDK is blocked,
 *    offline or absent, or its base model could not be fetched;
 *  - the SKIN, as the body material's map;
 *  - the HAT and BACK item, parented to real bones so they follow the moonwalk;
 *  - the PROPORTIONS, as scales and offsets on bones. Never rotations:
 *    `PlayerRig` rebuilds every bone quaternion each frame, and a rotation
 *    written here would be gone before it was drawn.
 *
 * Every player in the room is dressed, not just the local one: a look is
 * replicated by the server, so `RemotePlayer` owns one of these too and feeds
 * it the record it was sent.
 */
export class BloxityAvatar {
  private readonly character: PlayerCharacter;
  private readonly objLoader = new OBJLoader();
  private readonly textureLoader = new TextureLoader();

  private look: AvatarLook = BUNDLED_LOOK;

  private bodyKey = '';
  private bodyToken = 0;
  private bones = new Map<string, Bone>();
  private material: MeshStandardMaterial | null = null;
  private defaultMap: Texture | null = null;
  private wearingBloxityBody = false;
  /** Whether `material` belongs to a Bloxity body (not ours to dispose) or is our clone. */
  private wearingBloxityBodyMaterial = false;

  private readonly attachments = new Map<'hat' | 'back', Object3D>();
  private currentSkin: string | null = null;
  private currentHat: string | null = null;
  private currentBack: string | null = null;
  private readonly textures: Texture[] = [];

  private disposed = false;

  constructor(character: PlayerCharacter) {
    this.character = character;
    this.bind(character.modelRoot, false);
  }

  /** Wear this look. Safe to call on every patch; unchanged slots do no work. */
  apply(look: AvatarLook): void {
    if (this.disposed || looksMatch(look, this.look)) return;
    this.look = look;

    // The body is worn for anyone Bloxity can describe, equipped or not.
    const key = look.bloxity ? bodyKeyOf(look.items) : '';
    if (key !== this.bodyKey) {
      this.bodyKey = key;
      void this.rebuildBody(look.bloxity);
    }
    this.wearLayers();
  }

  /** What is currently worn, for diagnostics and for the panel's sliders. */
  get current(): AvatarLook {
    return this.look;
  }

  dispose(): void {
    this.disposed = true;
    this.bodyToken += 1;
    for (const node of this.attachments.values()) node.removeFromParent();
    this.attachments.clear();
    for (const texture of this.textures) texture.dispose();
    if (!this.wearingBloxityBodyMaterial) this.material?.dispose();
  }

  private async rebuildBody(wantsBody: boolean): Promise<void> {
    const token = (this.bodyToken += 1);
    const body = wantsBody ? await bloxityBodyFactory.build(this.look.items) : null;
    if (this.disposed || token !== this.bodyToken) return;

    const model = this.character.setModel(body);
    this.bind(model, body !== null);
    this.wearLayers();
    logger.info(SCOPE, body ? 'wearing the Bloxity body' : 'wearing the bundled body');
  }

  /** Re-collect everything tied to a particular model, and forget what was worn on the old one. */
  private bind(model: Object3D, bloxityBody: boolean): void {
    for (const node of this.attachments.values()) node.removeFromParent();
    this.attachments.clear();
    this.currentSkin = null;
    this.currentHat = null;
    this.currentBack = null;

    this.wearingBloxityBody = bloxityBody;
    this.bones = collectBones(model);

    // Only a material this class cloned is its to dispose; a Bloxity body's is
    // owned by the body and goes with it in `PlayerCharacter.setModel`. The
    // bundled body shares ONE material with every remote player, so it is
    // cloned before anything writes to it.
    if (this.material && !this.wearingBloxityBodyMaterial) this.material.dispose();
    let material: MeshStandardMaterial | null = null;
    model.traverse((child) => {
      if (!(child instanceof Mesh) || !(child.material instanceof MeshStandardMaterial)) return;
      material ??= bloxityBody ? child.material : child.material.clone();
      child.material = material;
    });
    this.material = material;
    this.wearingBloxityBodyMaterial = bloxityBody;
    this.defaultMap = (material as MeshStandardMaterial | null)?.map ?? null;
  }

  private wearLayers(): void {
    void this.applySkin();
    void this.applyItem('hat', this.look.items.hat);
    void this.applyItem('back', this.look.items.back);
    this.applyProportions(this.look.proportions);
  }

  // ------------------------------------------------------------------ skin

  private async applySkin(): Promise<void> {
    // Only the Bloxity body wears a Bloxity skin, and with none equipped it
    // wears Bloxity's default rather than rendering white.
    const wanted = this.wearingBloxityBody
      ? isEquippedId(this.look.items.skin)
        ? this.look.items.skin
        : DEFAULT_SKIN_ID
      : null;
    if (wanted === this.currentSkin) return;
    this.currentSkin = wanted;

    const material = this.material;
    if (!material) return;
    if (!wanted) {
      material.map = this.defaultMap;
      material.needsUpdate = true;
      return;
    }

    const url = await resolveSkinUrl(wanted);
    // Still wanted, on the same body? Either may have changed while resolving.
    if (this.disposed || this.currentSkin !== wanted || this.material !== material) return;

    this.textureLoader.load(
      url,
      (texture) => {
        if (this.disposed || this.currentSkin !== wanted || this.material !== material) {
          texture.dispose();
          return;
        }
        pixelArt(texture);
        this.textures.push(texture);
        material.map = texture;
        material.needsUpdate = true;
      },
      undefined,
      () => logger.warn(SCOPE, `skin ${wanted} failed to load`),
    );
  }

  // ----------------------------------------------------------------- items

  private async applyItem(slot: 'hat' | 'back', id: string | null): Promise<void> {
    const wanted = isEquippedId(id) ? id : null;
    const current = slot === 'hat' ? this.currentHat : this.currentBack;
    if (wanted === current) return;
    if (slot === 'hat') this.currentHat = wanted;
    else this.currentBack = wanted;

    this.attachments.get(slot)?.removeFromParent();
    this.attachments.delete(slot);
    if (!wanted) return;

    const anchor = this.bones.get(slot === 'hat' ? 'Neck1' : 'Spine2');
    if (!anchor) {
      logger.warn(SCOPE, `no bone to hang a ${slot} on`);
      return;
    }

    try {
      const urls = await resolveItemUrls(slot, wanted);
      const [object, texture] = await Promise.all([
        this.objLoader.loadAsync(urls.mesh),
        this.textureLoader.loadAsync(urls.texture),
      ]);
      const still = slot === 'hat' ? this.currentHat : this.currentBack;
      // `anchor.parent` is null once a body swap has taken this skeleton away.
      if (this.disposed || still !== wanted || !anchor.parent || !this.bones.has(anchor.name)) {
        texture.dispose();
        return;
      }
      pixelArt(texture);
      this.textures.push(texture);
      const material = new MeshStandardMaterial({ map: texture, roughness: 0.85 });
      object.traverse((child) => {
        if (child instanceof Mesh) {
          child.material = material;
          child.castShadow = true;
        }
      });

      /*
       * Sized in WORLD terms, not bone terms.
       *
       * The two bodies do not share a bone space - `player.fbx` bones live in
       * centimetres under a 0.01 root, the GLB's under its own - so a fixed
       * local scale would be right on one body and invisible on the other.
       * Dividing by the anchor's world scale gives both the size the item has
       * on Bloxity's own renderer, converted to this game's units.
       */
      anchor.updateWorldMatrix(true, false);
      const boneScale = anchor.getWorldScale(SCRATCH).y || 1;
      object.scale.setScalar(ITEM_WORLD_SCALE / boneScale);
      if (slot === 'hat') {
        object.position.set(0, (HAT_LIFT * ITEM_WORLD_SCALE) / boneScale, 0);
      } else {
        object.position.set(0, 0, this.wearingBloxityBody ? 0 : FBX_BACK_OFFSET / boneScale);
      }

      anchor.add(object);
      this.attachments.set(slot, object);
    } catch {
      logger.warn(SCOPE, `${slot} ${wanted} failed to load`);
    }
  }

  // ----------------------------------------------------------- proportions

  /**
   * Proportions, after the reference page's viewer: height stretches the body
   * vertically, arm length scales the arm bones, head scale scales the neck
   * bone while undoing the height stretch on it, neck height lifts the head.
   * Everything is relative to the bone's REST values, so the two bodies'
   * different units never need a per-body constant.
   */
  private applyProportions(p: AvatarProportions): void {
    const num = (value: number, fallback = 1): number =>
      Number.isFinite(value) ? value : fallback;
    const height = Math.max(0.05, num(p.height));

    const model = this.character.modelRoot;
    const base = (model.userData['baseScale'] as number | undefined) ?? model.scale.x;
    model.userData['baseScale'] = base;
    model.scale.set(base, base * height, base);

    this.scaleBone('Spine1', (rest, bone) => bone.scale.set(rest.x * num(p.torsoScaleX), rest.y, rest.z));
    this.scaleBone('Spine2', (rest, bone) => bone.scale.set(rest.x * num(p.shoulderWidth), rest.y, rest.z));
    for (const name of ['ArmL1', 'ArmR1']) {
      this.scaleBone(name, (rest, bone) => bone.scale.set(rest.x, rest.y * num(p.armLength), rest.z));
    }
    const head = num(p.headScale);
    this.scaleBone('Neck1', (rest, bone) => {
      bone.scale.set(rest.x * head, (rest.y * head) / height, rest.z * head);
    });
    this.moveBone('Neck1', (rest, bone) => {
      bone.position.y = rest.y * (1 + (num(p.neckHeight) - 1) * 0.8);
    });
    // Leg spread, proportional to how far each hip already sits off the centre.
    for (const name of ['LegL1', 'LegR1']) {
      this.moveBone(name, (rest, bone) => {
        bone.position.x = rest.x * (1 + (num(p.legOffsetX) - 1) * 0.5);
      });
    }
  }

  private scaleBone(name: string, write: (rest: Vector3, bone: Bone) => void): void {
    const bone = this.bones.get(name);
    if (!bone) return;
    bone.userData['restScale'] ??= bone.scale.clone();
    write(bone.userData['restScale'] as Vector3, bone);
  }

  private moveBone(name: string, write: (rest: Vector3, bone: Bone) => void): void {
    const bone = this.bones.get(name);
    if (!bone) return;
    bone.userData['restPosition'] ??= bone.position.clone();
    write(bone.userData['restPosition'] as Vector3, bone);
  }
}

/** Body parts only: a hat or skin change must not refetch an identical body. */
const bodyKeyOf = (items: AvatarItems): string =>
  [items.head, items.torso, items.armL, items.armR, items.legL, items.legR]
    .map((id) => (isEquippedId(id) ? id : '-'))
    .join('|');

/** Bloxity textures are 64px pixel art; smoothing turns faces into smudges. */
const pixelArt = (texture: Texture): void => {
  texture.colorSpace = SRGBColorSpace;
  texture.flipY = false;
  texture.magFilter = NearestFilter;
  texture.minFilter = NearestFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
};

/** Bones by name, first one wins - the same rule `PlayerRig` uses. */
const collectBones = (model: Object3D): Map<string, Bone> => {
  const found = new Map<string, Bone>();
  model.traverse((child) => {
    const bone = child as Bone;
    if (bone.isBone && !found.has(bone.name)) found.set(bone.name, bone);
  });
  return found;
};
