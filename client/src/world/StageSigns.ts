import { COURSE, STAGES, formatSpeed } from '@moonwalk/shared';
import { Group } from 'three';
import { CanvasSign } from './CanvasSign.js';

/**
 * The billboard at the head of each stage.
 *
 * "STAGE 2 / EASY / Recommended Level: 3", exactly as the reference art frames
 * it. The recommended level is ADVISORY and always has been - nothing gates a
 * stage, because a player who wants to try a run they are underlevelled for
 * should be allowed to fail at it.
 *
 * Distinct from the FINISH BANNER at the other end, which is the thing that
 * pays. This one is an introduction; that one is a reward.
 */
export class StageSigns {
  readonly root = new Group();

  private readonly signs: CanvasSign[] = [];

  constructor() {
    for (const stage of STAGES) {
      const sign = new CanvasSign(44, 15, [
        {
          text: `STAGE ${stage.index}`,
          size: 1.5,
          fill: '#ffffff',
          stroke: '#3a0d1c',
          strokeWidth: 0.2,
        },
        {
          text: stage.difficulty,
          size: 0.85,
          fill: '#ff8ab4',
          stroke: '#3a0d1c',
        },
        {
          // BOTH figures, because a level means nothing to a player looking at
          // a Speed counter. The Speed is derived from the level through the
          // curve the player actually levels on, so the two lines here can
          // never advertise different things.
          text: `Recommended Level: ${stage.recommendedLevel}`,
          size: 0.55,
          fill: '#ffffff',
          stroke: '#1a1030',
        },
        {
          text: `${formatSpeed(stage.recommendedSpeed)} Speed`,
          size: 0.5,
          fill: '#ffe14d',
          stroke: '#3a2a06',
        },
      ]);

      /*
       * Hung over the run-up, facing back down the course at the approaching
       * player rather than flat against the far wall.
       *
       * High, and set well into the stage. Stage one's sign in particular is
       * the first thing beyond the VIP arch, and at the arch's own height it
       * simply stacked on top of it from the spawn point - two large pieces of
       * world text arguing over the same patch of screen.
       */
      sign.mesh.position.set(0, COURSE.floorY + 21, stage.startZ + 17);
      sign.mesh.rotation.y = Math.PI;
      this.root.add(sign.mesh);
      this.signs.push(sign);
    }
  }

  dispose(): void {
    for (const sign of this.signs) sign.dispose();
    this.signs.length = 0;
    this.root.removeFromParent();
  }
}
