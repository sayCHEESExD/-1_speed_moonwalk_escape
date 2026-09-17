import { sanitiseDisplayName, sanitisePfpUrl, type SetIdentityMessage } from '@moonwalk/shared';
import type { LegionUser } from './legionTypes.js';

/**
 * The public identity to replicate for whoever the portal says is here.
 *
 * `displayName` first, `username` when the display name sanitises to nothing
 * (an all-emoji name, say), and empty - which the boards show as `GUEST_NAME` -
 * only for somebody genuinely not signed in. The account id is never read
 * here, and neither is anything else on the user object.
 *
 * A GUEST counts as signed out for the NAME. The SDK gives a guest a random
 * local nickname, which is not an identity - it changes when the browser is
 * cleared. The PORTRAIT is kept for a guest, though: the SDK renders it from
 * the avatar that guest is actually wearing, so it is still a true picture of
 * that character.
 */
export const identityFromLegion = (user: LegionUser | null): SetIdentityMessage => {
  if (!user) return { name: '', pfp: '' };
  const pfp = sanitisePfpUrl(user.pfp);
  if (user.isGuest) return { name: '', pfp };
  const name = sanitiseDisplayName(user.displayName) || sanitiseDisplayName(user.username);
  return { name, pfp };
};
