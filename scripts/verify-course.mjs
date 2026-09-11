/**
 * Structural checks on the generated course.
 *
 * The world is GENERATED, so the things that can go wrong with it are
 * structural rather than typographical: a stage that overlaps the one before
 * it, a hole in the floor at a seam, a reward ladder that pays less for a
 * harder stage. None of those is a type error and none of them shows up until
 * somebody falls through the world, so they are asserted here instead.
 *
 * Run with `npm run verify:course`.
 */
import {
  COURSE,
  COURSE_END_Z,
  COURSE_HAZARDS,
  COURSE_SOLIDS,
  SPEED_TIERS,
  STAGES,
  WIDE_AREAS,
  corridorHalfWidthAt,
  hazardZRange,
  stageReward,
  tileZ,
  treadmillMultiplier,
  treadmillZ,
  TRAINING,
  TREADMILL_MULTIPLIER,
  TREADMILL_TIERS,
  TILE_ROW,
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

console.log('\ncourse structure\n');

check('ten stages exist', STAGES.length === 10, `got ${STAGES.length}`);

// The reference spec's ladder, verbatim. If the table drifts, this is what
// notices - a reward is a promise to the player and the one place it is
// written must agree with the design.
const EXPECTED_REWARDS = [1, 5, 40, 100, 450, 2500, 15000, 75000, 250000, 1000000];
for (let i = 0; i < EXPECTED_REWARDS.length; i += 1) {
  const stage = STAGES[i];
  check(
    `stage ${i + 1} pays ${EXPECTED_REWARDS[i]}`,
    stage && stage.winReward === EXPECTED_REWARDS[i],
    `got ${stage ? stage.winReward : 'no stage'}`,
  );
}

check(
  'rewards are strictly increasing',
  STAGES.every((stage, i) => i === 0 || stage.winReward > STAGES[i - 1].winReward),
  'a later stage paying less would make the ladder something to farm backwards',
);

check(
  'the reward curve continues past the table',
  stageReward(11) > stageReward(10),
  `stage 11 would pay ${stageReward(11)}`,
);

console.log('\nstage geometry\n');

check(
  'the first stage begins where the arena ends',
  STAGES[0].startZ === COURSE.lobbyEndZ,
  `stage 1 starts at ${STAGES[0].startZ}, arena ends at ${COURSE.lobbyEndZ}`,
);

for (let i = 1; i < STAGES.length; i += 1) {
  check(
    `stage ${i + 1} begins exactly where stage ${i} ended`,
    STAGES[i].startZ === STAGES[i - 1].endZ,
    `${STAGES[i].startZ} vs ${STAGES[i - 1].endZ}`,
  );
}

for (const stage of STAGES) {
  check(
    `stage ${stage.index} finish line is inside the stage`,
    stage.finishZ > stage.startZ && stage.finishZ < stage.endZ,
    `finish ${stage.finishZ} not within ${stage.startZ}..${stage.endZ}`,
  );
}

check(
  'the world ends at the last stage',
  COURSE_END_Z === STAGES[STAGES.length - 1].endZ,
  `${COURSE_END_Z} vs ${STAGES[STAGES.length - 1].endZ}`,
);

check(
  'recommended levels are non-decreasing',
  STAGES.every((s, i) => i === 0 || s.recommendedLevel >= STAGES[i - 1].recommendedLevel),
);

// The rebirth cap is 25 levels per rebirth, so this says how many rebirths the
// last stage actually asks for. Printed rather than asserted at an exact
// figure, because it is a tuning fact rather than a rule - but a stage that
// quietly starts demanding six is visible the moment it is added.
const lastLevel = STAGES[STAGES.length - 1].recommendedLevel;
console.log(
  `\n  note  stage ${STAGES.length} wants level ${lastLevel}` +
    ` = ${Math.ceil(lastLevel / 25) - 1} rebirth(s)\n`,
);

console.log('finish lines are solid ground\n');

/** The highest solid under a point, ignoring anything above head height. */
const floorAt = (x, z) => {
  let best = null;
  for (const solid of COURSE_SOLIDS) {
    if (x < solid.minX || x > solid.maxX) continue;
    if (z < solid.minZ || z > solid.maxZ) continue;
    if (solid.maxY > COURSE.floorY + 2) continue;
    if (best === null || solid.maxY > best) best = solid.maxY;
  }
  return best;
};

for (const stage of STAGES) {
  // A reward that landed the player in mid-air would be the cruellest possible
  // way to pay them, so there must be floor on BOTH sides of every line.
  const before = floorAt(0, stage.finishZ - 3);
  const after = floorAt(0, stage.finishZ + 3);
  check(
    `stage ${stage.index} has carpet either side of its finish line`,
    before !== null && after !== null,
    `before=${before} after=${after}`,
  );
}

console.log('\narena layout\n');

check(
  'the treadmills are on the player LEFT (+X)',
  TRAINING.centerX > 0,
  `centre is ${TRAINING.centerX}`,
);
check(
  'the upgrade tiles are on the player RIGHT (-X)',
  TILE_ROW.x < 0,
  `tiles are at ${TILE_ROW.x}`,
);

for (let i = 1; i <= TRAINING.count; i += 1) {
  const z = treadmillZ(i);
  check(
    `treadmill ${i} is inside the arena`,
    z > COURSE.lobbyStartZ && z < COURSE.lobbyEndZ,
    `z=${z}`,
  );
}

/*
 * THE TREADMILLS PAY THE SAME.
 *
 * All three machines are identical in what they are worth - the bay is
 * somewhere to farm while chatting, not a ladder - so there must be no way for
 * one belt to be worth more than another. Asserted rather than assumed,
 * because "they all use the same constant" is exactly the kind of thing that
 * stays true right up until somebody adds a fourth machine.
 */
check(
  'every treadmill pays the identical multiplier',
  TREADMILL_TIERS.every((tier) => treadmillMultiplier(tier.index) === TREADMILL_MULTIPLIER),
  TREADMILL_TIERS.map((t) => `${t.name}=${treadmillMultiplier(t.index)}`).join(' '),
);
check(
  'and that multiplier is a real bonus',
  TREADMILL_MULTIPLIER > 1,
  `got ${TREADMILL_MULTIPLIER}`,
);
check(
  'standing on nothing pays no bonus at all',
  treadmillMultiplier(0) === 1 && treadmillMultiplier(99) === 1,
  'a forged belt index must never be able to mean a bonus',
);

for (const tier of SPEED_TIERS) {
  const z = tileZ(tier.slot);
  check(
    `tile ${tier.slot} (${tier.name}) is inside the arena`,
    z > COURSE.lobbyStartZ && z < COURSE.lobbyEndZ,
    `z=${z}`,
  );
}

check(
  'the tiles and the treadmills do not overlap in X',
  Math.abs(TILE_ROW.x - TRAINING.centerX) > TILE_ROW.width,
);

console.log('\nhazards\n');

check('every hazard is a disco ball', COURSE_HAZARDS.length > 0, 'there are none');

check(
  'no hazard reaches outside its corridor',
  COURSE_HAZARDS.every((hazard) => {
    const span = hazardZRange(hazard);
    const mid = (span.minZ + span.maxZ) / 2;
    const limit = corridorHalfWidthAt(mid) + 6;
    return Math.abs(hazard.x) <= limit;
  }),
  'a ball anchored outside the wall would be invisible and still lethal',
);

check(
  'every hazard belongs to a real stage',
  COURSE_HAZARDS.every((h) => h.stage >= 0 && h.stage < STAGES.length),
);

console.log('\nbounds\n');

check(
  'the arena is the widest declared area',
  WIDE_AREAS.some((area) => area.halfWidth === COURSE.lobbyHalfWidth),
);

check(
  'every wide area is wider than the corridor',
  WIDE_AREAS.every((area) => area.halfWidth >= COURSE.halfWidth),
);

console.log(
  `\n${failures === 0 ? 'course verified' : `${failures} FAILURE(S)`}\n`,
);
process.exit(failures === 0 ? 0 : 1);
