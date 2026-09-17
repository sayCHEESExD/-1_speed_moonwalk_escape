/**
 * The server's half of the Bloxity integration, exercised without a server.
 *
 * Bux are real money. The webhook is the ONLY way a purchase becomes Wins, so
 * every rule it holds is asserted here: a delivery without the shared secret is
 * refused, a server with no secret configured refuses rather than granting to
 * anyone, a retried transaction pays once, an unknown SKU is still answered 2xx
 * so Bloxity does not refund a purchase that was really made, and the queue is
 * on disk before the webhook answers.
 *
 * It also covers the two things a Bloxity IDENTITY decides: what a look is
 * allowed to contain once it has been off a client's machine, and what name a
 * board shows. Both are places where trusting the obvious thing would be
 * wrong - a look becomes a URL on fifteen other machines, and a display name
 * is not unique enough to key anybody's score on.
 *
 * Run with `npm run verify:bloxity`.
 */
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  sanitiseAvatarLook,
  sanitiseDisplayName,
  sanitisePfpUrl,
  portraitUrlFor,
  avatarLookFrom,
  temperProportion,
  PROPORTION_RANGES,
  PROPORTION_TEMPER,
  DISPLAY_NAME_MAX,
  GUEST_NAME,
} from '../shared/dist/index.js';
import { BuxGrants, SKU_WINS } from '../server/dist/bloxity/BuxGrants.js';
import { processBuxWebhook } from '../server/dist/bloxity/buxWebhook.js';

let failures = 0;
const check = (label, condition, detail = '') => {
  if (condition) {
    console.log(`  ok    ${label}`);
    return;
  }
  failures += 1;
  console.error(`  FAIL  ${label}${detail ? ` - ${detail}` : ''}`);
};

const body = (over = {}) =>
  JSON.stringify({
    transactionId: 'txn-1',
    userId: 'user-a',
    username: 'alice',
    gameSlug: 'speed-moonwalk-escape',
    sku: 'wins_small',
    productName: 'Pouch of Wins',
    productPrice: 100,
    metadata: {},
    timestamp: new Date().toISOString(),
    ...over,
  });

const SIGNED = { secret: 's3cret', allowUnsigned: false };

console.log('\nwebhook authentication\n');
{
  const grants = new BuxGrants(null);
  check('no secret header is refused', processBuxWebhook(undefined, body(), grants, SIGNED).status === 401);
  check('a wrong secret is refused', processBuxWebhook('nope', body(), grants, SIGNED).status === 401);
  check('a refused delivery grants nothing', grants.drain('user-a').length === 0);
  check(
    'a server with NO secret configured refuses rather than granting to anyone',
    processBuxWebhook(undefined, body(), grants, { secret: '', allowUnsigned: false }).status === 503,
  );
  check(
    'unsigned deliveries are accepted only when explicitly allowed (local dev)',
    processBuxWebhook(undefined, body({ transactionId: 'dev-1' }), grants, { secret: '', allowUnsigned: true }).status === 200,
  );
}

console.log('\nwebhook payloads\n');
{
  const grants = new BuxGrants(null);
  check('malformed JSON is a 400', processBuxWebhook('s3cret', '{not json', grants, SIGNED).status === 400);
  check('a missing transactionId is a 400', processBuxWebhook('s3cret', body({ transactionId: '' }), grants, SIGNED).status === 400);
  check('a missing userId is a 400', processBuxWebhook('s3cret', body({ userId: undefined }), grants, SIGNED).status === 400);

  const first = processBuxWebhook('s3cret', body(), grants, SIGNED);
  check('a valid delivery is 2xx', first.status === 200);
  const retry = processBuxWebhook('s3cret', body(), grants, SIGNED);
  check('a RETRIED delivery is still 2xx (so Bloxity stops retrying)', retry.status === 200);
  check('but reports it as a duplicate', retry.body.outcome === 'duplicate');

  const owed = grants.drain('user-a');
  check('the purchase is queued exactly ONCE', owed.length === 1, `queued ${owed.length}`);
  check('for the SKU table value, never a client figure', owed[0]?.wins === SKU_WINS.wins_small);
  check('draining empties the queue', grants.drain('user-a').length === 0);
  check('grants belong to the paying account only', grants.drain('user-b').length === 0);

  const unknown = processBuxWebhook('s3cret', body({ transactionId: 'txn-x', sku: 'from_the_future' }), grants, SIGNED);
  check('an unknown SKU is still 2xx, so a real purchase is not refunded', unknown.status === 200);
  check('and grants nothing', grants.drain('user-a').length === 0);
  check('the price in the payload is never used as a grant', !Object.values(SKU_WINS).includes(100));
}

console.log('\npersistence\n');
{
  const dir = mkdtempSync(join(tmpdir(), 'moonwalk-bux-'));
  const file = join(dir, 'bux-grants.json');
  try {
    const before = new BuxGrants(file);
    before.record('user-a', 'txn-9', 'wins_large');
    check('the queue is on disk before the webhook answers', readFileSync(file, 'utf8').includes('txn-9'));

    const after = new BuxGrants(file);
    check('a restarted server still owes the purchase', after.drain('user-a')[0]?.wins === SKU_WINS.wins_large);
    check(
      'and still recognises the transaction, so a post-restart retry does not pay twice',
      after.record('user-a', 'txn-9', 'wins_large') === 'duplicate',
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}


console.log('\nlooks off the wire\n');
{
  const clean = sanitiseAvatarLook({
    bloxity: true,
    items: { hat: '69c816be3ecd845acf82310d', skin: '-1', back: 'undefined', head: '' },
    proportions: { height: 1.2, headScale: 9, armLength: -4, neckHeight: 'x' },
  });
  check('a real item id survives', clean.items.hat === '69c816be3ecd845acf82310d');
  check("Bloxity's four spellings of NOTHING all become ''", clean.items.skin === '' && clean.items.back === '' && clean.items.head === '');
  check('an untouched slot is empty rather than undefined', clean.items.legR === '');
  check('an in-range proportion is kept', clean.proportions.height === 1.2);
  check('an out-of-range proportion is CLAMPED, not dropped', clean.proportions.headScale === 2.6 && clean.proportions.armLength === 0.05);
  check('a non-numeric proportion falls back to 1', clean.proportions.neckHeight === 1);

  const hostile = sanitiseAvatarLook({
    bloxity: 'yes',
    items: { hat: '../../etc/passwd', back: 'javascript:alert(1)', skin: 'a'.repeat(200) },
  });
  check('a path traversal never becomes a CDN URL', hostile.items.hat === '');
  check('a javascript: id never becomes a CDN URL', hostile.items.back === '');
  check('an absurdly long id is refused', hostile.items.skin === '');
  check('only a real boolean turns the Bloxity body on', hostile.bloxity === false);
  check('garbage in is still a COMPLETE look out', Object.keys(sanitiseAvatarLook(null).items).length === 9);
}

console.log('\nwho a board names\n');
{
  process.env.MOONWALK_DATA_DIR = mkdtempSync(join(tmpdir(), 'moonwalk-board-'));
  const { LeaderboardState } = await import('../server/dist/rooms/state/CourseState.js');
  const { PlayerState } = await import('../server/dist/rooms/state/PlayerState.js');
  const { leaderboardService } = await import('../server/dist/progression/LeaderboardService.js');
  const { profileStore } = await import('../server/dist/progression/ProfileStore.js');
  profileStore.open();

  const player = (over) => Object.assign(new PlayerState(), { wins: 10, totalSpeed: 10, rebirths: 0 }, over);

  // Someone who is here, signed in, and someone who is here as a guest.
  const board = new LeaderboardState();
  const live = [
    ['s1', player({ displayName: 'Chicken 877', avatarUrl: 'https://static.bloxity.io/img/pfps/3.png', wins: 50 })],
    ['s2', player({ wins: 20 })],
  ];
  const ids = new Map([['s1', 'id-a'], ['s2', 'id-b']]);
  leaderboardService.rebuild(board, live, ids);

  check('a signed-in player is shown by their Bloxity display name', board.wins[0].name === 'Chicken 877');
  check('with no @, no tag and no generated word pair', !/[@_]/.test(board.wins[0].name));
  check('their Bloxity picture rides along with it', board.wins[0].avatar === 'https://static.bloxity.io/img/pfps/3.png');
  check(`a player with no Bloxity identity is "${GUEST_NAME}"`, board.wins[1].name === GUEST_NAME);
  // A row without an account is still a row about a PLAYER, so it carries
  // Bloxity's render of the look that player is wearing. Only their own
  // account picture outranks it.
  check(
    'a row without an account still carries that player’s own portrait',
    board.wins[1].avatar === portraitUrlFor(avatarLookFrom(live[1][1].avatar)),
  );
  check(
    'and a signed-in account’s own picture outranks the derived one',
    board.wins[0].avatar === 'https://static.bloxity.io/img/pfps/3.png',
  );
  check('an empty place is blank, not a name', board.wins[2].name === '');
  check(
    'no row anywhere is an internal id',
    ![...board.wins, ...board.speed, ...board.rebirths].some((row) => row.name === 'id-a' || row.name === 'id-b'),
  );

  // Two people really can choose the same display name. The board keys on the
  // id it never shows, so they must stay two rows.
  const twins = new LeaderboardState();
  leaderboardService.rebuild(
    twins,
    [
      ['s1', player({ displayName: 'Chicken 877', wins: 50 })],
      ['s2', player({ displayName: 'Chicken 877', wins: 20 })],
    ],
    ids,
  );
  check('two players sharing a display name are still two rows', twins.wins[0].value === 50 && twins.wins[1].value === 20);

  // A player who has left is still on the board, by the name last verified.
  profileStore.save('id-c', player({ displayName: 'Disco Fox', avatarUrl: 'https://static.bloxity.io/img/pfps/7.png', wins: 900 }));
  const offline = new LeaderboardState();
  leaderboardService.rebuild(offline, [], new Map());
  check('an offline player keeps their name on the board', offline.wins[0].name === 'Disco Fox');
  check('and their picture', offline.wins[0].avatar === 'https://static.bloxity.io/img/pfps/7.png');

  // Signing out must not rename someone's saved history to Guest.
  profileStore.save('id-c', player({ displayName: '', wins: 900 }));
  const afterLogout = new LeaderboardState();
  leaderboardService.rebuild(afterLogout, [], new Map());
  check('signing out does not wipe the name the board already knew', afterLogout.wins[0].name === 'Disco Fox');

  rmSync(process.env.MOONWALK_DATA_DIR, { recursive: true, force: true });
}


console.log('\nproportions a player can actually run in\n');
{
  // Bloxity's sliders span sizes a viewer can show and a course cannot be run
  // at. Every value one can produce - and every value a hostile client can
  // send instead - has to land inside the playable band.
  const hostile = [0, -0, -1, -1e9, 1e9, Number.NaN, Number.POSITIVE_INFINITY, undefined, null];
  let worstLow = Infinity;
  let worstHigh = 0;
  let outOfBand = 0;
  let notOrdered = 0;

  for (const [key, range] of Object.entries(PROPORTION_RANGES)) {
    const band = PROPORTION_TEMPER[key];
    const samples = [];
    for (let i = 0; i <= 40; i += 1) samples.push(range[0] + ((range[1] - range[0]) * i) / 40);

    let previous = -Infinity;
    for (const value of samples) {
      const applied = temperProportion(value, key);
      if (!(applied >= band.min && applied <= band.max)) outOfBand += 1;
      if (applied < previous - 1e-9) notOrdered += 1;
      previous = applied;
      worstLow = Math.min(worstLow, applied);
      worstHigh = Math.max(worstHigh, applied);
    }

    for (const value of hostile) {
      const applied = temperProportion(value, key);
      if (!Number.isFinite(applied) || applied < band.min || applied > band.max) outOfBand += 1;
    }
  }

  check('every slider value lands inside its playable band', outOfBand === 0, `${outOfBand} escaped`);
  check('a bigger slider value is never a smaller character', notOrdered === 0);
  check('nothing can make a player microscopic', worstLow >= 0.4, `smallest ${worstLow}`);
  check('nothing can make a player gigantic', worstHigh <= 2.2, `largest ${worstHigh}`);
  check('NaN and undefined resolve to the default scale', [Number.NaN, undefined, 'x'].every((v) => temperProportion(v, 'height') === 1));
  check('a zero scale is clamped to the smallest playable size, never to zero', temperProportion(0, 'height') === PROPORTION_TEMPER.height.min);
  check('the DEFAULT avatar is left exactly alone', Object.keys(PROPORTION_RANGES).every((key) => temperProportion(1, key) === 1));
  check(
    'a tall avatar is still taller than a short one',
    temperProportion(1.6, 'height') > temperProportion(1, 'height') && temperProportion(1, 'height') > temperProportion(0.5, 'height'),
  );
}

console.log('\nwho the portal says a player is\n');
{
  check('a plain display name survives', sanitiseDisplayName('Chicken 877') === 'Chicken 877');
  check('a non-Latin name survives', sanitiseDisplayName('中文名字') === '中文名字');
  check('markup and control characters are stripped', sanitiseDisplayName('<b>Chicken</b>') === 'bChickenb');
  check('a bidirectional override cannot be used to impersonate', !sanitiseDisplayName('Chicken\u202e877').includes('\u202e'));
  check('a name is bounded in characters', sanitiseDisplayName('x'.repeat(200)).length === DISPLAY_NAME_MAX);
  check('a signed-out player sanitises to nothing at all', sanitiseDisplayName(undefined) === '' && sanitiseDisplayName('') === '');
  check(`which the boards show as "${GUEST_NAME}"`, GUEST_NAME === 'Guest');

  check(
    'a Bloxity portrait survives',
    sanitisePfpUrl('https://static.bloxity.io/img/pfps/3.png?width=128') === 'https://static.bloxity.io/img/pfps/3.png?width=128',
  );
  check('a portrait from anywhere else is refused', sanitisePfpUrl('https://example.com/x.png') === '');
  check('a lookalike host is refused', sanitisePfpUrl('https://static.bloxity.io.example.com/x.png') === '');
  check('a javascript: portrait is refused', sanitisePfpUrl('javascript:alert(1)') === '');
  check('a portrait carrying quotes or spaces is refused', sanitisePfpUrl('https://static.bloxity.io/a b".png') === '');
}


console.log('\nportraits\n');
{
  // Bloxity renders a headshot for any avatar and serves it from a URL built
  // out of that avatar. The scheme is THEIRS - taken from the SDK bundle - so
  // these assertions are what stop it drifting into something of ours that
  // happens to look similar and 404s for every player.
  const look = (items = {}, proportions = {}) =>
    avatarLookFrom({ bloxity: true, ...items, ...proportions });
  const base = 'https://static.bloxity.io/img/pfps';
  const tail = '?width=128&quality=85&v=2';

  check('a default avatar is s0', portraitUrlFor(look()) === `${base}/s0.png${tail}`);
  check(
    'a skin is the key',
    portraitUrlFor(look({ skin: '69cb00f6c3c4aac219abd8c3' })) ===
      `${base}/s69cb00f6c3c4aac219abd8c3.png${tail}`,
  );
  check(
    'a hat and a back item are appended in that order',
    portraitUrlFor(look({ skin: '69cb00f6c3c4aac219abd8c3', hat: 'AAA', back: 'BBB' })) ===
      `${base}/s69cb00f6c3c4aac219abd8c3_hAAA_bBBB.png${tail}`,
  );
  check(
    'body parts pull in the parts-and-proportions half',
    portraitUrlFor(look({ head: 'HHH' })) ===
      `${base}/s0_hdHHH_aL0_aR0_lL0_lR0_to0_p1f0-1f0-1f0-1f0-1f0-1f0-1f0.png${tail}`,
  );
  check(
    'so does a changed proportion, printed their way',
    portraitUrlFor(look({}, { height: 1.25 })).includes('_p1f25-1f0-1f0-1f0-1f0-1f0-1f0.png'),
  );
  check(
    'an unequipped slot is 0, never an empty string',
    !portraitUrlFor(look({ head: 'HHH', armL: '', legR: '-1' })).includes('_aL_'),
  );
  check(
    'two different looks never share a portrait',
    portraitUrlFor(look({ skin: 'A' })) !== portraitUrlFor(look({ skin: 'B' })),
  );
  check(
    'the proportions are printed in Bloxity\u2019s order, height first',
    portraitUrlFor(look({}, { headScale: 1.5 })).includes('-1f5.png'),
  );

  check(
    'a portrait given as a PATH resolves onto the asset host',
    sanitisePfpUrl('/img/pfps/s0.png') === 'https://static.bloxity.io/img/pfps/s0.png',
  );
  check('a protocol-relative host is still refused', sanitisePfpUrl('//evil.example/x.png') === '');
  check('a derived portrait survives its own sanitiser', sanitisePfpUrl(portraitUrlFor(look())) === portraitUrlFor(look()));
}

console.log(`\n${failures === 0 ? 'bloxity verified' : `${failures} FAILURE(S)`}\n`);
process.exit(failures === 0 ? 0 : 1);
