/**
 * Checks on the progression curves.
 *
 * Level, Speed, the rebirth ladder and the upgrade ladder are pure functions,
 * so they can be verified without a server, a room or a browser. What they can
 * get wrong is not a crash - it is a curve that stalls, a cap that wraps, or a
 * ladder that lets a purchase downgrade somebody. All three are silent in
 * production and obvious here.
 *
 * Run with `npm run verify:progression`.
 */
import {
  BASE_LEVEL_CAP,
  MAX_WINS,
  SPEED_TIERS,
  STARTER_TIER_SLOT,
  bestTier,
  canRebirth,
  formatSpeed,
  maxLevelForRebirth,
  nextRebirthTier,
  ownsTier,
  rebirthMultiplier,
  resolveLevel,
  resolveMovementProfile,
  speedForNextLevel,
  tierForSlot,
  totalSpeedToReach,
  withTier,
} from '../shared/dist/index.js';

let failures = 0;

const check = (label, condition, detail = '') => {
  if (condition) {
    console.log(`  ok    ${label}`);
    return;
  }
  failures += 1;
  console.error(`  FAIL  ${label}${detail ? ` - ${detail}` : ''}`);
};

console.log('\nthe level curve\n');

check('everyone starts at level 1', resolveLevel(0, 25).level === 1);
check('level 1 costs nothing', totalSpeedToReach(1) === 0);

check(
  'the curve is monotonic',
  Array.from({ length: 120 }, (_, i) => i + 1).every(
    (level) => level === 1 || totalSpeedToReach(level) > totalSpeedToReach(level - 1),
  ),
);

check(
  'each level costs more than the last',
  Array.from({ length: 120 }, (_, i) => i + 1).every(
    (level) => level === 1 || speedForNextLevel(level) >= speedForNextLevel(level - 1),
  ),
);

// The closed form in `resolveLevel` is corrected by two loops at the
// boundaries. This is what proves the correction actually lands: for every
// level, the exact threshold must resolve to that level and one unit less must
// resolve to the one below.
check(
  'resolveLevel agrees with totalSpeedToReach at every boundary',
  Array.from({ length: 100 }, (_, i) => i + 2).every((level) => {
    const at = totalSpeedToReach(level);
    return (
      resolveLevel(at, 200).level === level && resolveLevel(at - 1, 200).level === level - 1
    );
  }),
);

check(
  'the bar reads full at the cap',
  resolveLevel(totalSpeedToReach(60) * 10, 25).capped === true,
);

console.log('\nthe rebirth ladder\n');

check('the first rebirth is at level 25', nextRebirthTier(0).requiredLevel === 25);
check('the second is at level 50', nextRebirthTier(1).requiredLevel === 50);
check('the third is at level 75', nextRebirthTier(2).requiredLevel === 75);
check('the fourth is at level 100', nextRebirthTier(3).requiredLevel === 100);

check(
  'the ladder continues in steps of 25 for ever',
  Array.from({ length: 40 }, (_, i) => i).every(
    (count) => nextRebirthTier(count + 1).requiredLevel - nextRebirthTier(count).requiredLevel === 25,
  ),
);

check('the base cap is the first rebirth requirement', BASE_LEVEL_CAP === 25);

check(
  'the cap and the requirement are the same moment',
  Array.from({ length: 20 }, (_, i) => i).every(
    (count) => maxLevelForRebirth(count) === nextRebirthTier(count).requiredLevel,
  ),
  'reaching the cap must be exactly what unlocks the rebirth',
);

check(
  'rebirth is refused below the cap and allowed at it',
  !canRebirth(24, 0) && canRebirth(25, 0) && !canRebirth(49, 1) && canRebirth(50, 1),
);

check(
  'the multiplier rises with every rebirth',
  Array.from({ length: 30 }, (_, i) => i).every(
    (count) => rebirthMultiplier(count + 1) > rebirthMultiplier(count),
  ),
);

check('no rebirths means no multiplier', rebirthMultiplier(0) === 1);

console.log('\nthe upgrade ladder\n');

check('the starter tier is free', tierForSlot(STARTER_TIER_SLOT).winsRequired === 0);

check(
  'both ladders climb together',
  SPEED_TIERS.every(
    (tier, i) =>
      i === 0 ||
      (tier.speedPerStep > SPEED_TIERS[i - 1].speedPerStep &&
        tier.winsRequired > SPEED_TIERS[i - 1].winsRequired),
  ),
  'a tile that cost more and gave less would be a trap',
);

check(
  'movement bonuses are gentle',
  SPEED_TIERS.every((tier) => tier.moveBonus >= 1 && tier.moveBonus <= 1.6),
  'movement is already multiplied by level and by rebirth',
);

check(
  'an unknown slot falls back to the starter, never to nothing',
  tierForSlot(0).slot === STARTER_TIER_SLOT && tierForSlot(999).slot === STARTER_TIER_SLOT,
);

// The rule that makes a purchase incapable of downgrading anybody: the
// equipped tier is the best OWNED, so buying a lower one changes the mask and
// nothing else.
const owningSeven = withTier(withTier(0, 1), 7);
check(
  'buying a lower tier cannot downgrade a higher one',
  bestTier(withTier(owningSeven, 4)).slot === 7,
);
check('ownership round-trips', ownsTier(withTier(0, 5), 5) && !ownsTier(withTier(0, 5), 6));

console.log('\nmovement\n');

check(
  'the movement multiplier rises with level',
  resolveMovementProfile(30, 0).multiplier > resolveMovementProfile(1, 0).multiplier,
);

check(
  'the level term tapers rather than running away',
  // The soft cap converges on x2 from levelling alone, however long anyone
  // grinds. Late-game speed is meant to come from REBIRTH, not from levels.
  resolveMovementProfile(500, 0).multiplier < 2.1,
  `level 500 gives x${resolveMovementProfile(500, 0).multiplier.toFixed(2)}`,
);

check(
  'rebirth is where late-game speed comes from',
  resolveMovementProfile(25, 4).multiplier > resolveMovementProfile(500, 0).multiplier,
);

check(
  'jump velocity scales far more gently than travel speed',
  (() => {
    const low = resolveMovementProfile(1, 0);
    const high = resolveMovementProfile(25, 6);
    const speedRatio = high.runSpeed / low.runSpeed;
    const jumpRatio = high.jumpVelocity / low.jumpVelocity;
    return jumpRatio < speedRatio / 2;
  })(),
  'distance is meant to come from approach speed, not from a bigger hop',
);

console.log('\nreplication limits\n');

check('the Wins ceiling is a uint32', MAX_WINS === 4294967295);
check('formatSpeed is compact at every scale', formatSpeed(940) === '940' && formatSpeed(1_500_000).endsWith('M'));

console.log(
  `\n${failures === 0 ? 'progression verified' : `${failures} FAILURE(S)`}\n`,
);
process.exit(failures === 0 ? 0 : 1);
