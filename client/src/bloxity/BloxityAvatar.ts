import {
  BUNDLED_LOOK,
  isEquippedId,
  looksMatch,
  temperProportion,
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
  DEFAULT_SKIN_URL,
  assetUrl,
  describeItem,
  peekItem,
} from './bloxityAssets.js';

const SCOPE = 'bloxity/avatar';

/*
 * How an accessory is sized, and why there are two answers.
 *
 * A hat is a CHILD OF A BONE, so it already inherits everything above it - the
 * body's own scale and every proportion written onto the bones. The right
 * local scale is therefore the one the item was authored at, and nothing else:
 * dividing by the anchor's WORLD scale (which is what this file used to do)
 * cancels that inheritance and pins the hat to a fixed world size, so a small
 * avatar wears a giant hat and a tall one wears a doll's. That is the
 * model-space/world-space bug, and the fix is to stay in model space.
 *
 * Bloxity's body IS the rig these items were authored for, so it gets
 * Bloxity's own numbers: scale 1, and a hat lifted 0.8 up the head bone, which
 * is what their renderer parents it at. The bundled `player.fbx` is a
 * different bone space and keeps the values tuned for it.
 */
/** An item's scale in the bundled body's bone space. */
const FBX_ITEM_SCALE = 0.9;
/** A hat sits this far up the head bone, on the bundled body. */
const FBX_HAT_LIFT = 0.55;
/** A back item sits this far behind the chest, on the bundled body. */
const FBX_BACK_OFFSET = -0.35;
/** Bloxity's own hat lift on their own body. */
const BLOXITY_HAT_LIFT = 0.8;

/**
 * The multiplier a proportion actually applies.
 *
 * `temperProportion` lives in `shared/` with the reasoning and the bounds: a
 * slider built for a viewer spans sizes a player cannot run a course at, so
 * every value is scaled toward 1 and clamped. It is also what stops a zero, a
 * NaN or a missing field ever reaching a scale.
 */
const temper = temperProportion;

const SCRATCH = new Vector3();

/**
 * One character's Bloxity appearance - local or remote, identically.
 *
 * Four things, each where it belongs:
 *
 *  - the BODY: `player.glb` with its parts swapped in, worn whenever Bloxity
 *    could describe this player at all. THE DEFAULT AVATAR IS BLOXITY'S: a
 *    player who never opened the customiser still has one, and it is that body
 *    wearing `skins/0.png`. The bundled `player.fbx` is the fallback for the
 *    SDK being blocked, offline or absent, or its base model unreachable;
 *  - the SKIN, as the body material's map, from the catalogue's own path;
 *  - the HAT and BACK item, parented to real bones so they follow the moonwalk,
 *    at the scale they were authored at (see above);
 *  - the PROPORTIONS, as scales and offsets on bones, relative to each bone's
 *    REST value. Never rotations: `PlayerRig` rebuilds every bone quaternion
 *    each frame, so a rotation written here would be gone before it was drawn.
 *
 * Every player in the room gets one of these, fed from replicated state, so
 * there is exactly one construction path and nobody can look different on
 * their own screen to how they look on everybody else's.
 */
export class BloxityAvatar {
  private readonly character: PlayerCharacter;
  private readonly objLoader = new OBJLoader();
  private readonly textureLoader = new TextureLoader();

  /** The look as ASKED for, before a hat has had its say about the head. */
  private requested: AvatarLook = BUNDLED_LOOK;
  /** The look actually worn, after `forceHead`. */
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
    if (this.disposed) return;
    this.requested = look;

    const worn = this.forceHead(look);
    if (looksMatch(worn, this.look) && this.bodyKey === (worn.bloxity ? bodyKeyOf(worn.items) : '')) {
      return;
    }
    this.look = worn;

    // The body is worn for anyone Bloxity can describe, equipped or not.
    const key = worn.bloxity ? bodyKeyOf(worn.items) : '';
    if (key !== this.bodyKey) {
      this.bodyKey = key;
      void this.rebuildBody(worn.bloxity);
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

  /**
   * Let a hat override the head, the way the portal does.
   *
   * Bloxity applies `forceHeadId` when a hat is EQUIPPED - it writes the value
   * straight into `headId` - so a look that came from the portal already obeys
   * it. It is applied again here because a renderer should not depend on that:
   * a look can reach this game from replicated state or from an account
   * dressed before the hat declared the constraint, and in each of those a
   * stale custom head is drawn INSIDE a helmet modelled around the stock one,
   * which is exactly the "distorted avatar" players were seeing.
   *
   * An unknown hat is fetched and the look re-applied when it lands, rather
   * than awaited: a hat nobody has seen before must not stall a player who is
   * already on screen.
   */
  private forceHead(look: AvatarLook): AvatarLook {
    const hatId = look.items.hat;
    if (!hatId) return look;

    const hat = peekItem(hatId);
    if (hat === undefined) {
      void describeItem(hatId).then(() => {
        if (this.disposed || this.requested.items.hat !== hatId) return;
        this.apply(this.requested);
      });
      return look;
    }

    const forced = hat?.forceHeadId;
    if (forced === undefined || forced === null) return look;

    // `'-1'` is Bloxity's "none", and none means the DEFAULT head - their
    // renderer restores the stock geometry rather than hiding anything.
    const head = isEquippedId(forced) ? forced : '';
    if (head === look.items.head) return look;
    return { ...look, items: { ...look.items, head } };
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
    // bundled body shares ONE material with every other default character, so
    // it is cloned before anything writes to it.
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
    // Only the Bloxity body wears a Bloxity skin - the texture is UV-mapped
    // for that body and would be garbage on the bundled one - and with none
    // equipped it wears Bloxity's own default rather than rendering white.
    const wanted = this.wearingBloxityBody
      ? isEquippedId(this.look.items.skin)
        ? this.look.items.skin
        : ''
      : null;
    if (wanted === this.currentSkin) return;
    this.currentSkin = wanted;

    const material = this.material;
    if (!material) return;
    if (wanted === null) {
      material.map = this.defaultMap;
      material.needsUpdate = true;
      return;
    }

    // The catalogue knows where a skin lives; nothing here guesses a path.
    let url = DEFAULT_SKIN_URL;
    if (wanted) {
      const item = await describeItem(wanted);
      const path = item?.assetPaths?.texture;
      if (!path) {
        logger.warn(SCOPE, `skin ${wanted} is not in the catalogue - wearing the default skin`);
      } else {
        url = assetUrl(path);
      }
    }
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
      () => logger.warn(SCOPE, `skin ${wanted || 'default'} failed to load`),
    );
  }

  // ----------------------------------------------------------------- items

  private async applyItem(slot: 'hat' | 'back', id: string): Promise<void> {
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

    // The catalogue knows where the item lives; an item it does not know is
    // simply not worn, and the rest of the avatar is unaffected.
    const item = await describeItem(wanted);
    const meshPath = item?.assetPaths?.mesh;
    const texturePath = item?.assetPaths?.texture;
    if (!meshPath || !texturePath) {
      logger.warn(SCOPE, `${slot} ${wanted} has no mesh in the catalogue - not worn`);
      return;
    }

    try {
      const [object, texture] = await Promise.all([
        this.objLoader.loadAsync(assetUrl(meshPath)),
        this.textureLoader.loadAsync(assetUrl(texturePath)),
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

      // MODEL space, not world space: the item is a child of the bone and
      // inherits the body's scale and proportions with it, which is what makes
      // a small avatar's hat small. See the note at the top of this file.
      const native = this.wearingBloxityBody;
      object.scale.setScalar(native ? 1 : FBX_ITEM_SCALE);
      if (slot === 'hat') {
        object.position.set(0, native ? BLOXITY_HAT_LIFT : FBX_HAT_LIFT, 0);
      } else {
        object.position.set(0, 0, native ? 0 : FBX_BACK_OFFSET);
      }

      anchor.add(object);
      this.attachments.set(slot, object);
    } catch {
      logger.warn(SCOPE, `${slot} ${wanted} failed to load`);
    }
  }

  // ----------------------------------------------------------- proportions

  /**
   * Proportions, as Bloxity's own renderer applies them.
   *
   * Taken from the shipped SDK rather than invented here - its viewer loop
   * does exactly this, and a player who set their sliders in the portal should
   * see the character they were shown there:
   *
   *   character.scale.set(1, height, 1)          // a vertical stretch
   *   Neck1.scale   = rest * headScale, with y over height   // undo it
   *   Neck_Offset.y = rest.y * (1 + height - headScale)      // keep the head on
   *   Neck_Offset.y += bind.y * (neckHeight - 1) * 0.8
   *   Arm*.scale.y  = rest.y * armLength
   *
   * Height being a Y stretch and not a uniform scale IS Bloxity's look, and
   * the neck compensation is why it does not read as a stretched head.
   *
   * The three the SDK's in-page viewer does not render - `shoulderWidth`,
   * `torsoScaleX`, `legOffsetX`, which it only feeds into the portrait hash -
   * go to the bones that were plainly authored for them: the rig carries
   * `ArmL_Offset`/`ArmR_Offset` at x = +/-2 and `LegL_Offset`/`LegR_Offset` at
   * x = +/-0.6, so widening the shoulders and spreading the legs is those
   * offsets scaled. Writing them onto `Spine2` instead - which is what this
   * did before - stretched the whole torso mesh sideways, and on this rig the
   * leg bones themselves sit at x = 0, so the spread did nothing at all.
   *
   * Two rules keep it working on BOTH bodies: everything is relative to the
   * bone's REST value, so the rigs' different units need no per-body constant,
   * and every slot falls back on its own - the bundled FBX has no `_Offset`
   * bones, so shoulders and legs fall back to the bones it does have while
   * everything else still applies.
   */
  private applyProportions(p: AvatarProportions): void {
    const height = temper(p.height, 'height');
    const head = temper(p.headScale, 'headScale');
    const arm = temper(p.armLength, 'armLength');
    const neck = temper(p.neckHeight, 'neckHeight');
    const shoulders = temper(p.shoulderWidth, 'shoulderWidth');
    const torso = temper(p.torsoScaleX, 'torsoScaleX');
    const spread = temper(p.legOffsetX, 'legOffsetX');

    // HEIGHT, on the model and nowhere else. The body is fitted to this game
    // exactly once, in the factory, and this multiplies that one figure - so
    // there is no second place a scale is applied and nothing can double it.
    const model = this.character.modelRoot;
    const base = (model.userData['baseScale'] as number | undefined) ?? model.scale.x;
    model.userData['baseScale'] = base;
    model.scale.set(base, base * height, base);

    // TORSO width.
    this.scaleBone('Spine1', (rest, bone) => bone.scale.set(rest.x * torso, rest.y, rest.z));

    // ARM length. On the upper arm only: the SDK scales every bone whose name
    // starts with `Arm`, and because the forearm is a CHILD of the upper arm
    // that compounds to the square of the figure - an arm three times as long
    // becoming nine. Applying it once lands on the figure that was asked for.
    for (const name of ['ArmL1', 'ArmR1']) {
      this.scaleBone(name, (rest, bone) => bone.scale.set(rest.x, rest.y * arm, rest.z));
    }

    // SHOULDER width: the arm offsets, or the chest on a rig without them.
    if (this.bones.has('ArmL_Offset') || this.bones.has('ArmR_Offset')) {
      for (const name of ['ArmL_Offset', 'ArmR_Offset']) {
        this.moveBone(name, (rest, bone) => {
          bone.position.x = rest.x * shoulders;
        });
      }
    } else {
      this.scaleBone('Spine2', (rest, bone) => bone.scale.set(rest.x * shoulders, rest.y, rest.z));
    }

    // HEAD size, with the height stretch taken back out of it - Bloxity's own
    // compensation, and the reason a tall avatar's head is not an egg.
    this.scaleBone('Neck1', (rest, bone) => {
      bone.scale.set(rest.x * head, (rest.y * head) / height, rest.z * head);
    });

    // NECK height, on the offset the SDK writes it to, and carrying the head
    // back to where the stretch and the head scale left it.
    const neckNode = this.bones.has('Neck_Offset') ? 'Neck_Offset' : 'Neck1';
    this.moveBone(neckNode, (rest, bone) => {
      bone.position.y = rest.y * (1 + height - head) + rest.y * (neck - 1) * 0.8;
    });

    // LEG spread: the hip offsets, or the leg bones on a rig without them.
    const legs = this.bones.has('LegL_Offset') ? ['LegL_Offset', 'LegR_Offset'] : ['LegL1', 'LegR1'];
    for (const name of legs) {
      this.moveBone(name, (rest, bone) => {
        bone.position.x = rest.x * spread;
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

  /** Where a nameplate should float, in world units above the character's feet. */
  headHeight(): number {
    const neck = this.bones.get('Neck1');
    if (!neck) return 0;
    neck.updateWorldMatrix(true, false);
    neck.getWorldPosition(SCRATCH);
    return SCRATCH.y - this.character.root.position.y;
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
