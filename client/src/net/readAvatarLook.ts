import { avatarLookFrom, type AvatarLook } from '@moonwalk/shared';
import type { NetAvatarState } from './netTypes.js';

/**
 * Fold a replicated appearance back into the record the rest of the game
 * speaks.
 *
 * The shape knowledge - seventeen flat schema fields, and the laundering every
 * look goes through - lives in `shared/`, because the server reassembles the
 * same fields to build a player's portrait. This is the client's end of that
 * one definition, and the boundary where a replicated string becomes a CDN URL
 * on THIS machine.
 */
export const readAvatarLook = (state: NetAvatarState | undefined): AvatarLook =>
  avatarLookFrom(state);
