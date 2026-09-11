import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';

const clientRoot = fileURLToPath(new URL('.', import.meta.url));
const repoAssets = fileURLToPath(new URL('../assets', import.meta.url));

/**
 * Files that live in `assets/` but are never loaded at runtime, so they must
 * not be shipped to browsers.
 *
 * `base_rig.fbx` is byte-identical to `player.fbx`. `walk.mp3` is a supplied
 * footstep sound the game does not use: the moonwalk's scuff is synthesised
 * because it fires several times a second and has to track the cadence clamp,
 * which a fixed-length file cannot. It is kept in the repo rather than deleted
 * - it is supplied art - but there is no reason to send it to a browser that
 * will never ask for it.
 */
const UNSHIPPED_ASSETS = ['player/base_rig.fbx', 'audio/walk.mp3'];

/** Drops UNSHIPPED_ASSETS after Vite copies publicDir into the build output. */
const pruneUnusedAssets = (): Plugin => ({
  name: 'moonwalk:prune-unused-assets',
  apply: 'build',
  async closeBundle() {
    for (const relativePath of UNSHIPPED_ASSETS) {
      await rm(join(clientRoot, 'dist', relativePath), { force: true });
    }
  },
});

export default defineConfig({
  plugins: [pruneUnusedAssets()],
  root: clientRoot,
  /**
   * Serve the repo-level `assets/` directory directly as the public root, so
   * the FBX and its texture are reachable at `/player/*` with NO duplicate
   * copies of the source assets inside the client workspace.
   */
  publicDir: repoAssets,
  server: {
    // Deliberately neither 5173 nor 5174: the two previous games in this
    // series run their own dev servers there, and sharing a port means
    // whichever started first silently serves the wrong project.
    port: 5175,
    strictPort: true,
    // Reachable from a phone on the same LAN for mobile testing.
    host: true,
  },
  preview: {
    port: 4175,
    strictPort: true,
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'es2022',
    sourcemap: false,
    // Browser build budget is 12 MB; warn well before we get close.
    chunkSizeWarningLimit: 1500,
    rollupOptions: {
      output: {
        manualChunks: {
          three: ['three'],
          net: ['colyseus.js'],
        },
      },
    },
  },
});
