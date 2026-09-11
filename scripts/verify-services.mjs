/**
 * The server's decisions, exercised without a server.
 *
 * `StageService` and `UpgradeService` are where Wins are granted and spent,
 * and both are pure functions of a `PlayerState` plus a position. That makes
 * them testable directly, which matters more here than anywhere else in the
 * codebase: every rule they hold is a rule about somebody's money, and the
 * failure mode of getting one wrong is a player paid twice or charged twice.
 *
 * Run with `npm run verify:services`.
 */
import { STAGES, tierForSlot } from '../shared/dist/index.js';
import { StageService } from '../server/dist/progression/StageService.js';
import { UpgradeService } from '../server/dist/progression/UpgradeService.js';
import { SpeedService } from '../server/dist/progression/SpeedService.js';
import { wallet } from '../server/dist/progression/Wallet.js';

let failures = 0;

const check = (label, condition, detail = '') => {
  if (condition) {
    console.log(`  ok    ${label}`);
    return;
  }
  failures += 1;
  console.error(`  FAIL  ${label}${detail ? ` - ${detail}` : ''}`);
};

/**
 * A stand-in for the replicated schema.
 *
 * Deliberately a plain object rather than a real `PlayerState`: the services
 * only ever read and write fields, so constructing Colyseus schemas here would
 * add a decorator runtime to a test that is about arithmetic.
 */
const makePlayer = (over = {}) => ({
  sessionId: 'test',
  x: 0,
  y: 0,
  z: 0,
  wins: 0,
  totalSpeed: 0,
  level: 1,
  maxLevel: 25,
  rebirths: 0,
  tierSlot: 1,
  ownedTiers: 1,
  speedPerStep: 1,
  moveMultiplier: 1,
  jumpVelocity: 23,
  bestStage: 0,
  stageProgress: 0,
  treadmill: 0,
  grounded: true,
  ...over,
});

console.log('\nstage rewards\n');

{
  const stages = new StageService();
  const player = makePlayer();
  stages.beginRun(player);

  const first = STAGES[0];
  // Short of the line: nothing at all.
  player.z = first.finishZ - 1;
  check(
    'a stage short of the line pays nothing',
    stages.claim(player, 1).granted === false,
    'the position check is the whole guard against a forged claim',
  );
  check('and takes no Wins', player.wins === 0);

  // Past it: paid, once.
  player.z = first.finishZ + 1;
  const award = stages.claim(player, 1);
  check('crossing the line pays', award.granted === true);
  check(`stage 1 pays exactly ${first.winReward}`, player.wins === first.winReward);
  check('progress advances', player.stageProgress === 1);
  check('the best stage is recorded', player.bestStage === 1);

  // THE double-payment test. There is no teleport behind a finish banner, so
  // the player is still standing past the line - and must not be paid again.
  const again = stages.claim(player, 1);
  check(
    'standing past the line does not pay twice',
    again.granted === false && again.reason === 'out-of-order',
    `got ${again.reason}`,
  );
  check('and the wallet is unchanged', player.wins === first.winReward);

  // Skipping ahead is refused even when the player is genuinely past that
  // line, so the ladder cannot be collected out of order or all at once.
  player.z = STAGES[4].finishZ + 1;
  check(
    'a later stage cannot be claimed out of order',
    stages.claim(player, 5).granted === false,
  );
  check(
    'but the next one in sequence can',
    stages.claim(player, 2).granted === true,
  );
  check(
    'and pays its own reward',
    player.wins === STAGES[0].winReward + STAGES[1].winReward,
    `wins=${player.wins}`,
  );

  // A new run re-opens the whole ladder: the reward is for RUNNING a stage,
  // not for having once reached it.
  stages.beginRun(player);
  player.z = STAGES[0].finishZ + 1;
  check('a new run can bank stage 1 again', stages.claim(player, 1).granted === true);

  check('an unknown stage is refused', stages.claim(player, 999).granted === false);
  check('stage 0 is refused', stages.claim(player, 0).granted === false);
}

console.log('\nupgrade tiles\n');

{
  const upgrades = new UpgradeService();
  const speeds = new SpeedService();
  const player = makePlayer();
  speeds.initialise(player);
  upgrades.initialise(player);

  check('the starter tier is equipped from the first frame', player.tierSlot === 1);
  check('and it grants a real per-stride rate', player.speedPerStep > 0);

  const tier2 = tierForSlot(2);

  // Standing nowhere near the tile.
  player.x = 0;
  player.z = 0;
  player.wins = tier2.winsRequired;
  check(
    'a tile cannot be bought from across the room',
    upgrades.claim(player, 2, speeds).reason === 'not-on-tile',
  );
  check('and nothing is deducted', player.wins === tier2.winsRequired);

  // On the tile, but broke. Position is checked BEFORE money, and money is
  // taken last of all, so a refusal can never half-complete a purchase.
  const { TILE_ROW, tileZ } = await import('../shared/dist/index.js');
  player.x = TILE_ROW.x;
  player.y = 0;
  player.z = tileZ(2);
  player.wins = tier2.winsRequired - 1;
  const poor = upgrades.claim(player, 2, speeds);
  check('a tile cannot be bought without the Wins', poor.reason === 'too-poor');
  check('and nothing is deducted', player.wins === tier2.winsRequired - 1);
  check('and nothing is granted', player.tierSlot === 1);

  // Affordable, and standing on it.
  player.wins = tier2.winsRequired + 3;
  const bought = upgrades.claim(player, 2, speeds);
  check('a tile on the floor with the Wins in hand is sold', bought.granted === true);
  check('the price is deducted exactly once', player.wins === 3, `wins=${player.wins}`);
  check('the tier is equipped', player.tierSlot === 2);
  check(
    'and the per-stride rate rose with it',
    player.speedPerStep === tier2.speedPerStep,
  );

  check(
    'the same tile cannot be bought twice',
    upgrades.claim(player, 2, speeds).reason === 'already-owned',
  );
  check('and the wallet is unchanged', player.wins === 3);

  // THE rule that makes a purchase incapable of downgrading anybody.
  player.wins = 10_000_000;
  player.z = tileZ(7);
  upgrades.claim(player, 7, speeds);
  check('a higher tier equips', player.tierSlot === 7);
  player.z = tileZ(4);
  upgrades.claim(player, 4, speeds);
  check(
    'buying a LOWER tier afterwards does not downgrade',
    player.tierSlot === 7,
    `equipped ${player.tierSlot}`,
  );
}

console.log('\ntreadmills\n');

{
  /*
   * THE THREE BELTS PAY THE SAME.
   *
   * Not "they read the same constant" - that is an implementation detail and
   * it is what the course suite checks. This is the end-to-end version: run a
   * real `SpeedService.credit` for a player standing on each belt in turn, for
   * the same simulated step, and compare the Speed that actually lands in
   * their total. If a future change routes one machine through a different
   * path, this is what notices.
   */
  const { TREADMILL_TIERS } = await import('../shared/dist/index.js');
  const speeds = new SpeedService();

  const earnOn = (treadmill) => {
    const player = makePlayer({ treadmill });
    speeds.initialise(player);
    speeds.reset(player.sessionId, player);
    // The first credit only establishes the baseline, so pay twice and read
    // the second - exactly as a live session does.
    speeds.credit(player.sessionId, player, 1 / 60);
    const before = player.totalSpeed;
    speeds.credit(player.sessionId, player, 1 / 60);
    return player.totalSpeed - before;
  };

  const gains = TREADMILL_TIERS.map((tier) => earnOn(tier.index));
  const first = gains[0];

  check(
    'all three belts exist to be tested',
    TREADMILL_TIERS.length === 3,
    `got ${TREADMILL_TIERS.length}`,
  );
  check(
    'a belt pays something at all',
    first > 0,
    `got ${first}`,
  );
  check(
    'every belt pays the IDENTICAL Speed for the identical step',
    gains.every((gain) => gain === first),
    TREADMILL_TIERS.map((t, i) => `${t.name}=${gains[i]}`).join(' '),
  );
  check(
    'and a belt pays more than the open floor',
    first > earnOn(0),
    `belt=${first} floor=${earnOn(0)}`,
  );
}

console.log('\nthe wallet\n');

{
  const player = makePlayer({ wins: 10 });
  check('spending what you have succeeds', wallet.spend(player, 10) === true);
  check('and empties the wallet', player.wins === 0);
  check('spending what you do not have fails', wallet.spend(player, 1) === false);
  check('and changes nothing', player.wins === 0);

  wallet.add(player, 50);
  check('adding credits', player.wins === 50);
  wallet.add(player, -5);
  check('a negative credit is ignored', player.wins === 50);
  wallet.add(player, Number.NaN);
  check('a NaN credit is ignored', player.wins === 50);

  // `wins` is a uint32 on the wire, so an addition past the ceiling must
  // SATURATE. Wrapping would reset somebody's wallet at the moment they banked
  // the biggest reward in the game.
  player.wins = 4_294_967_000;
  wallet.add(player, 1_000_000);
  check('a huge award saturates rather than wrapping', player.wins === 4_294_967_295);
}

console.log(`\n${failures === 0 ? 'services verified' : `${failures} FAILURE(S)`}\n`);
process.exit(failures === 0 ? 0 : 1);
