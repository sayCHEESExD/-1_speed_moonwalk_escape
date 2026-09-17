import { join } from 'node:path';
import { serverConfig } from '../config/serverConfig.js';
import { BuxGrants } from './BuxGrants.js';

/**
 * The process-wide grant queue, persisted beside the player profiles.
 *
 * Kept apart from `BuxGrants` itself so the class can be exercised in tests
 * without touching this server's data directory.
 */
export const buxGrants = new BuxGrants(join(serverConfig.dataDir, 'bux-grants.json'));
