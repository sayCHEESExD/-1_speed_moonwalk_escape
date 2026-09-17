import { BUNDLED_LOOK, sanitiseAvatarLook, type AvatarLook } from '@moonwalk/shared';
import type { NetAvatarState } from './netTypes.js';

/**
 * Fold a replicated appearance back into the record the rest of the game
 * speaks.
 *
 * Colyseus schema fields are flat, so a look travels as seventeen fields and
 * is reassembled HERE and nowhere else - one place that knows the wire shape,
 * so a renamed field is one compile error rather than a character silently
 * wearing nothing.
 *
 * Sanitised on the way in as well as on the way out. The server already
 * laundered it, but this is the boundary where a string becomes a CDN URL on
 * THIS machine, and a client that trusted the room it happened to be connected
 * to would be trusting whatever answered on that port.
 */
export const readAvatarLook = (state: NetAvatarState | undefined): AvatarLook => {
  if (!state) return BUNDLED_LOOK;
  return sanitiseAvatarLook({
    bloxity: state.bloxity,
    items: {
      hat: state.hat,
      back: state.back,
      skin: state.skin,
      head: state.head,
      torso: state.torso,
      armL: state.armL,
      armR: state.armR,
      legL: state.legL,
      legR: state.legR,
    },
    proportions: {
      height: state.height,
      shoulderWidth: state.shoulderWidth,
      armLength: state.armLength,
      legOffsetX: state.legOffsetX,
      torsoScaleX: state.torsoScaleX,
      neckHeight: state.neckHeight,
      headScale: state.headScale,
    },
  });
};
