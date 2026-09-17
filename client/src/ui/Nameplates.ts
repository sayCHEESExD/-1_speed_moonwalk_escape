import { Vector3, type Object3D, type PerspectiveCamera } from 'three';
import type { PlayerCharacter } from '../player/PlayerCharacter.js';

/** World units past which a plate is not drawn at all. */
const MAX_DISTANCE = 140;
/** Nearer than this to the camera a plate is hidden: it would be a label in the lens. */
const MIN_DISTANCE = 2.5;
/** Distance at which a plate is full size. It shrinks beyond this. */
const FULL_SIZE_DISTANCE = 22;
/** Smallest a far plate is drawn, so it is still legible right up until it goes. */
const MIN_SCALE = 0.6;
/** World units above the neck joint - clears the head and most hats. */
const HEAD_CLEARANCE = 1.15;
/** Used only when a character has no neck to find, measured up from its root. */
const FALLBACK_HEIGHT = 4.2;
/** The joint a plate hangs over. `player.fbx` and Bloxity's body share the rig. */
const NECK_BONE = 'Neck1';

interface Plate {
  readonly root: HTMLDivElement;
  readonly pfp: HTMLImageElement;
  readonly label: HTMLSpanElement;
  /** What is currently written into the DOM, so a frame that changes nothing writes nothing. */
  text: string;
  src: string;
  shown: boolean;
  transform: string;
  depth: number;
  /** The model the neck was found on, so a body swap looks again. */
  model: Object3D | null;
  neck: Object3D | null;
}

/**
 * The name chips over every player's head, the local player included.
 *
 * DOM, not geometry, and that is the fix for the size problem rather than a
 * stylistic choice. A plate in the world scales with whatever it is parented
 * to, so an avatar wearing Bloxity's smallest height would carry a name nobody
 * could read and the tallest would carry a banner. These are positioned in
 * SCREEN space from the projected neck joint and sized by CAMERA DISTANCE
 * alone, so every plate is the same size on screen whatever the avatar under
 * it is built like - and the browser draws the text crisply at any pixel
 * ratio, which a canvas texture does not.
 *
 * Positioned AFTER the frame is rendered, from the matrices that render just
 * computed. Projecting before it would place every plate where its player was
 * one frame ago - invisible at a walk, and a label trailing metres behind
 * somebody covering four hundred units a second.
 *
 * ONE plate per key, created on first sight and removed when its player stops
 * being put, so a rejoin or a body swap can never leave a second plate behind.
 * Every write is guarded by a comparison, and nothing here reads layout: the
 * viewport is handed in on resize rather than measured per frame, so moving
 * fifteen elements costs fifteen transforms and never a forced reflow.
 */
export class Nameplates {
  private readonly layer: HTMLDivElement;
  private readonly plates = new Map<string, Plate>();
  /** Keys put this frame; anything not in here by `end` has left. */
  private readonly touched = new Set<string>();
  private readonly point = new Vector3();
  private readonly eye = new Vector3();

  private camera: PerspectiveCamera | null = null;
  private width = window.innerWidth;
  private height = window.innerHeight;

  constructor(container: HTMLElement) {
    this.layer = document.createElement('div');
    this.layer.className = 'mwe-plates';
    container.appendChild(this.layer);
  }

  /** The canvas size in CSS pixels. Called by the renderer's resize, never per frame. */
  setViewport(width: number, height: number): void {
    this.width = width;
    this.height = height;
  }

  /** Start a frame. */
  begin(camera: PerspectiveCamera): void {
    this.camera = camera;
    this.eye.setFromMatrixPosition(camera.matrixWorld);
    this.touched.clear();
  }

  /** Place one player's plate for this frame. */
  put(key: string, character: PlayerCharacter, name: string, pfp: string): void {
    const camera = this.camera;
    if (!camera) return;
    this.touched.add(key);

    const plate = this.plates.get(key) ?? this.create(key);
    this.write(plate, name, pfp);

    const point = this.point;
    this.anchor(plate, character, point);

    /*
     * A NaN distance HIDES the plate rather than drawing it.
     *
     * Written as a positive test on purpose: every comparison against NaN is
     * false, so `distance > MAX || distance < MIN` lets one straight through
     * and the plate is then positioned at `NaNpx`. It really happens - for the
     * frames before the camera has been placed - and it is the same class of
     * bug as a zero scale, so it is refused the same way.
     */
    const distance = point.distanceTo(this.eye);
    if (!(distance >= MIN_DISTANCE && distance <= MAX_DISTANCE)) {
      this.show(plate, false);
      return;
    }

    point.project(camera);
    // Behind the camera, past the far plane, or well off screen.
    if (!(point.z > -1 && point.z < 1 && Math.abs(point.x) <= 1.1 && Math.abs(point.y) <= 1.1)) {
      this.show(plate, false);
      return;
    }

    const x = Math.round((point.x + 1) * 0.5 * this.width);
    const y = Math.round((1 - point.y) * 0.5 * this.height);
    const scale = Math.min(1, Math.max(MIN_SCALE, FULL_SIZE_DISTANCE / distance));
    // The stylesheet sets the origin at the plate's bottom centre, so the
    // scale shrinks it toward the head rather than away from it.
    const transform = `translate3d(${x}px, ${y}px, 0) translate(-50%, -100%) scale(${scale.toFixed(2)})`;
    if (transform !== plate.transform) {
      plate.transform = transform;
      plate.root.style.transform = transform;
    }

    // Nearer players draw over farther ones, as they would in the world.
    const depth = Math.max(0, Math.round(MAX_DISTANCE - distance));
    if (depth !== plate.depth) {
      plate.depth = depth;
      plate.root.style.zIndex = String(depth);
    }

    this.show(plate, true);
  }

  /** Finish a frame: remove the plate of anyone who was not put. */
  end(): void {
    for (const [key, plate] of this.plates) {
      if (this.touched.has(key)) continue;
      plate.root.remove();
      this.plates.delete(key);
    }
  }

  dispose(): void {
    for (const plate of this.plates.values()) plate.root.remove();
    this.plates.clear();
    this.layer.remove();
  }

  private create(key: string): Plate {
    const root = document.createElement('div');
    root.className = 'mwe-plate mwe-plate--bare';
    root.hidden = true;

    const pfp = document.createElement('img');
    pfp.className = 'mwe-plate__pfp';
    pfp.alt = '';
    pfp.draggable = false;
    pfp.decoding = 'async';
    pfp.hidden = true;
    // A portrait that will not load is dropped rather than drawn as a broken
    // image: the name on its own is still a complete plate.
    pfp.addEventListener('error', () => {
      pfp.hidden = true;
      root.classList.add('mwe-plate--bare');
    });

    const label = document.createElement('span');
    label.className = 'mwe-plate__name';

    root.append(pfp, label);
    this.layer.appendChild(root);

    const plate: Plate = {
      root,
      pfp,
      label,
      text: '',
      src: '',
      shown: false,
      transform: '',
      depth: -1,
      model: null,
      neck: null,
    };
    this.plates.set(key, plate);
    return plate;
  }

  /** Name and portrait. `textContent`, never markup: the name is a player's own text. */
  private write(plate: Plate, name: string, pfp: string): void {
    if (plate.text !== name) {
      plate.text = name;
      plate.label.textContent = name;
    }
    if (plate.src !== pfp) {
      plate.src = pfp;
      if (pfp) {
        plate.pfp.src = pfp;
        plate.pfp.hidden = false;
      } else {
        plate.pfp.removeAttribute('src');
        plate.pfp.hidden = true;
      }
      plate.root.classList.toggle('mwe-plate--bare', !pfp);
    }
  }

  /**
   * Where over a character the plate goes, in world space.
   *
   * Over the NECK JOINT rather than at a fixed height, so it follows that
   * player's own proportions: a shorter avatar's plate sits lower and a taller
   * one's higher, which is what makes a plate belong to the character under it
   * rather than hover at a height chosen for the average. The clearance is
   * scaled by the model's own scale for the same reason. The joint is looked
   * up again whenever the model changes - a Bloxity body arriving replaces
   * every bone object on the character.
   */
  private anchor(plate: Plate, character: PlayerCharacter, out: Vector3): void {
    const model = character.modelRoot;
    if (plate.model !== model) {
      plate.model = model;
      // Depth-first, so the REAL joint is found before its zero-length
      // terminal twin - the same first-of-each-name rule `PlayerRig` binds by.
      plate.neck = model.getObjectByName(NECK_BONE) ?? null;
    }

    if (plate.neck) {
      plate.neck.getWorldPosition(out);
      /*
       * Scaled by the avatar's HEIGHT multiplier, not by the model's own
       * scale. The two bodies are fitted to this game at wildly different
       * numbers - the bundled FBX is authored in centimetres - so multiplying
       * by `scale.y` directly would put the plate a hundredth of a unit above
       * a neck. The multiplier is what the proportions did on top of that fit,
       * which is the only part a clearance should follow.
       */
      const base = (model.userData['baseScale'] as number | undefined) ?? model.scale.y;
      const heightFactor = base > 0 ? model.scale.y / base : 1;
      out.y += HEAD_CLEARANCE * heightFactor;
    } else {
      character.root.getWorldPosition(out);
      out.y += FALLBACK_HEIGHT;
    }
  }

  private show(plate: Plate, shown: boolean): void {
    if (plate.shown === shown) return;
    plate.shown = shown;
    plate.root.hidden = !shown;
  }
}
