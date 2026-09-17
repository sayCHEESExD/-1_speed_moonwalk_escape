import { Schema, type } from '@colyseus/schema';
import {
  AVATAR_SLOTS,
  DEFAULT_PROPORTIONS,
  sanitiseAvatarLook,
  type AvatarLook,
} from '@moonwalk/shared';

/**
 * What a player's character wears, replicated to everyone in the room.
 *
 * This is the one piece of state the server does not decide. It cannot: what a
 * player looks like is Bloxity's answer to a question only that player's own
 * session can ask, and there is no server-to-server route to another account's
 * wardrobe. So the client reports it, the server LAUNDERS it
 * (`sanitiseAvatarLook` - ids become CDN URLs on fifteen other machines) and
 * replicates it.
 *
 * Nothing here touches progression, which is why taking it from a client is
 * safe in a way that taking a position never would be. The worst a forged look
 * can do is dress its own character in a different hat.
 *
 * `bloxity` is what decides which BODY is drawn, and it is NOT "is anything
 * equipped": a player who never opened the customiser still has a Bloxity
 * default avatar, and that is Bloxity's body with Bloxity's default skin. The
 * bundled character is only for someone the SDK could not describe at all.
 */
export class AvatarState extends Schema {
  @type('boolean') bloxity = false;

  @type('string') hat = '';
  @type('string') back = '';
  @type('string') skin = '';
  @type('string') head = '';
  @type('string') torso = '';
  @type('string') armL = '';
  @type('string') armR = '';
  @type('string') legL = '';
  @type('string') legR = '';

  @type('float32') height = 1;
  @type('float32') shoulderWidth = 1;
  @type('float32') armLength = 1;
  @type('float32') legOffsetX = 1;
  @type('float32') torsoScaleX = 1;
  @type('float32') neckHeight = 1;
  @type('float32') headScale = 1;

  /**
   * Take a look off the wire.
   *
   * Assigns only what actually CHANGED: the schema encoder treats an identical
   * write as a change, and a client that re-reports the same look on every
   * avatar event would otherwise broadcast seventeen fields to the whole room
   * each time.
   */
  apply(raw: unknown): void {
    const look: AvatarLook = sanitiseAvatarLook(raw);
    if (this.bloxity !== look.bloxity) this.bloxity = look.bloxity;
    for (const slot of AVATAR_SLOTS) {
      if (this[slot] !== look.items[slot]) this[slot] = look.items[slot];
    }
    for (const key of Object.keys(DEFAULT_PROPORTIONS) as (keyof typeof DEFAULT_PROPORTIONS)[]) {
      if (this[key] !== look.proportions[key]) this[key] = look.proportions[key];
    }
  }
}
