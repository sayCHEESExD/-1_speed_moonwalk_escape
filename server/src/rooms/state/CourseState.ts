import { ArraySchema, MapSchema, Schema, type } from '@colyseus/schema';
import { LEADERBOARD_SIZE, PROTOCOL_VERSION } from '@moonwalk/shared';
import { PlayerState } from './PlayerState.js';

/** One row of one board: who, and how much. */
export class LeaderEntry extends Schema {
  /**
   * The player's Bloxity display name, `GUEST_NAME` for anyone who has not
   * signed in, and '' for an empty row.
   *
   * Never an id and never derived from one. The board shows who a player is,
   * and the only authority on that is the Bloxity profile the server verified.
   */
  @type('string') name = '';
  /** Their Bloxity profile picture, so a row reads as a person. '' if unknown. */
  @type('string') avatar = '';
  @type('float64') value = 0;
}

/**
 * The three boards on the arena's back wall.
 *
 * FIXED-LENGTH arrays, allocated once and written in place. A board is
 * rewritten every couple of seconds, and clearing and refilling nine entries
 * each time would send the whole thing to every client on every rebuild
 * whether or not a single place had actually changed.
 *
 * Everything in here is the server's own figure. No client is asked for its
 * totals, and none could usefully claim any: these come from the same state
 * the rewards are paid into.
 */
export class LeaderboardState extends Schema {
  @type([LeaderEntry]) wins = rows();
  @type([LeaderEntry]) speed = rows();
  @type([LeaderEntry]) rebirths = rows();
}

const rows = (): ArraySchema<LeaderEntry> => {
  const list = new ArraySchema<LeaderEntry>();
  for (let i = 0; i < LEADERBOARD_SIZE; i += 1) list.push(new LeaderEntry());
  return list;
};

/**
 * Root replicated state for a single world instance.
 *
 * There is no guard here, and that is deliberate. Every player is chased by
 * their OWN guard, simulated on their own machine: replicating one per player
 * would put fifteen chasing entities on the wire at twenty hertz to draw
 * fourteen things nobody is allowed to see.
 */
export class CourseState extends Schema {
  /**
   * What this server can be asked for, as one number.
   *
   * IN THE STATE rather than behind an HTTP call, because the state is the one
   * channel a client already has and it crosses origins without a CORS header:
   * the client and the server are served from different hosts, so a `/health`
   * probe is blocked by the browser before it is ever answered.
   *
   * An older server has no such field at all, which reads as `undefined` and
   * is treated as protocol 1 - and that is precisely the case this exists for.
   * See `PROTOCOL_VERSION`: a message an older server has no handler for does
   * not fail, it CLOSES the connection, and a player who is not in a room
   * earns nothing and is called nothing.
   */
  @type('uint8') protocol = PROTOCOL_VERSION;

  @type({ map: PlayerState }) players = new MapSchema<PlayerState>();

  /**
   * Server uptime in seconds.
   *
   * Not a diagnostic: it is the CLOCK that every disco ball is a pure function
   * of. The server evaluates them against this to decide a death, and the
   * client evaluates the identical functions against the replicated value to
   * draw them - so there is no hazard state on the wire at all.
   */
  @type('float64') elapsed = 0;

  @type(LeaderboardState) leaderboard = new LeaderboardState();
}
