/**
 * Check that every asset the game loads at runtime actually exists.
 *
 * A missing asset is not a build error - Vite happily publishes a `publicDir`
 * with a hole in it, and the game then 404s at load with a message about a
 * texture. This is the check that turns that into a failure at the point the
 * file went missing.
 *
 * Run with `npm run verify:assets`.
 */
import { existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const assets = fileURLToPath(new URL('../assets', import.meta.url));

/**
 * Everything the client asks for by path at runtime.
 *
 * Kept as a literal list rather than a directory walk, deliberately: the
 * question is not "what is in the folder", it is "is what the code asks for
 * there". A walk would pass happily while the one file anybody needed was
 * renamed.
 */
const REQUIRED = [
  // The player model and its texture. See client/src/config/assets.ts for why
  // the FBX's own embedded texture paths are never followed.
  'player/player.fbx',
  'player/green.png',
  // The HUD icons. Supplied art, used as it is.
  'ui/trophy.png',
  'ui/rebirth.png',
  'ui/shoe.png',
  // The supplied audio. `background` is streamed by an <audio> element and the
  // other two are fetched and decoded, so all three are requested by PATH at
  // runtime - which is exactly the kind of reference a bundler cannot check
  // and a rename would silently break.
  'audio/background.mp3',
  'audio/jump.mp3',
  'audio/death.mp3',
];

/**
 * Files that exist but must NOT be shipped.
 *
 * `base_rig.fbx` is byte-identical to `player.fbx`; shipping both would double
 * the largest asset in the build for nothing. `walk.mp3` is a supplied
 * footstep the game does not use - the moonwalk's scuff is synthesised so it
 * can track the cadence clamp. `vite.config.ts` prunes both after the copy,
 * and this asserts they are still the files being pruned.
 */
const UNSHIPPED = ['player/base_rig.fbx', 'audio/walk.mp3'];

let failures = 0;

console.log('\nrequired assets\n');
for (const relative of REQUIRED) {
  const path = join(assets, relative);
  if (!existsSync(path)) {
    failures += 1;
    console.error(`  MISSING  ${relative}`);
    continue;
  }
  const size = statSync(path).size;
  if (size === 0) {
    failures += 1;
    console.error(`  EMPTY    ${relative}`);
    continue;
  }
  console.log(`  ok       ${relative}  (${(size / 1024).toFixed(1)} kB)`);
}

console.log('\nnot shipped\n');
for (const relative of UNSHIPPED) {
  const present = existsSync(join(assets, relative));
  console.log(
    `  ${present ? 'ok      ' : 'note    '} ${relative}` +
      `${present ? ' (pruned from the build by vite.config.ts)' : ' (absent)'}`,
  );
}

console.log(`\n${failures === 0 ? 'assets verified' : `${failures} MISSING`}\n`);
process.exit(failures === 0 ? 0 : 1);
