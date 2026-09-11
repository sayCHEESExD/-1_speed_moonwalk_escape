import type { Scene } from 'three';
import type { NetPlayerState } from '../net/netTypes.js';
import { RemotePlayer } from './RemotePlayer.js';

/**
 * Every other player in the room.
 *
 * A thin registry: it owns the lifetime of each `RemotePlayer` and nothing
 * else. All the reconstruction lives in `RemotePlayer`, so a remote character
 * is animated by exactly the code the local one is.
 */
export class RemotePlayerManager {
  private readonly players = new Map<string, RemotePlayer>();
  private readonly scene: Scene;

  constructor(scene: Scene) {
    this.scene = scene;
  }

  get count(): number {
    return this.players.size;
  }

  add(sessionId: string, state: NetPlayerState): void {
    if (this.players.has(sessionId)) return;
    const player = new RemotePlayer(state);
    this.players.set(sessionId, player);
    this.scene.add(player.character.root);
  }

  update(sessionId: string, state: NetPlayerState): void {
    this.players.get(sessionId)?.apply(state);
  }

  remove(sessionId: string): void {
    const player = this.players.get(sessionId);
    if (!player) return;
    player.dispose();
    this.players.delete(sessionId);
  }

  advance(delta: number): void {
    for (const player of this.players.values()) player.update(delta);
  }

  dispose(): void {
    for (const player of this.players.values()) player.dispose();
    this.players.clear();
  }
}
