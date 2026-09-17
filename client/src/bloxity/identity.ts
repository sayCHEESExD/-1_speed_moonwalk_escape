import { sanitiseDisplayName, sanitisePfpUrl, type SetIdentityMessage } from '@moonwalk/shared';
import type { LegionUser } from './legionTypes.js';

/**
 * The public identity to replicate for whoever the portal says is here.
 *
 * ONE user object, and both fields come out of it: `displayName` first,
 * `username` when the display name sanitises to nothing (an all-emoji name,
 * say), and the portrait the SDK hands out beside it. The account id is never
 * read here, and neither is anything else.
 *
 * NOTHING ELSE MAY SUPPRESS THE NAME. A guest rule used to live here - the
 * portrait was kept and the name blanked, on the reasoning that the SDK's
 * random guest nickname is not really an identity - and its exact signature
 * was a player whose avatar icon appeared correctly beside the word "Guest".
 * Whatever the portal decides to call somebody IS what this game calls them;
 * an empty name means the SDK had no name to give, and only then does
 * `GUEST_NAME` appear.
 */
export const identityFromLegion = (user: LegionUser | null): SetIdentityMessage => {
  if (!user) return { name: '', pfp: '' };
  return {
    name: sanitiseDisplayName(user.displayName) || sanitiseDisplayName(user.username),
    pfp: sanitisePfpUrl(user.pfp),
  };
};
