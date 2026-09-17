import { resolve } from 'node:path';
import { DEFAULT_SERVER_PORT, SERVER_TICK_RATE } from '@moonwalk/shared';

/** Runtime server configuration, overridable by environment variables. */
export interface ServerConfig {
  readonly port: number;
  readonly host: string;
  readonly tickRate: number;
  /** Milliseconds between state patches sent to clients. */
  readonly patchRateMs: number;
  /** Directory holding persisted player profiles. */
  readonly dataDir: string;
  /** The commit this server was built from, or 'unknown'. Reported by /health. */
  readonly buildVersion: string;
  /**
   * Shared secret Bloxity sends as `x-legion-webhook-secret`. Without one the
   * Bux webhook REFUSES every delivery (so Bloxity refunds), because an
   * unauthenticated endpoint would grant Wins to anybody who found it.
   */
  readonly buxWebhookSecret: string;
  /** Accept unsigned webhooks when no secret is set. Local development only. */
  readonly buxAllowUnsigned: boolean;
  /** Bloxity's API, for verifying player tokens. */
  readonly bloxityApiBase: string;
}

const int = (value: string | undefined, fallback: number): number => {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) ? parsed : fallback;
};

/**
 * `--port N` from the command line.
 *
 * Takes precedence over `PORT`, and the dev script passes it. That order
 * matters: a dev harness that hosts the CLIENT often exports `PORT` for its
 * own web server, and without an explicit override the game server silently
 * binds to the same port - which looks like a working server and a client that
 * cannot reach it. Managed hosts have no argv to pass, so `PORT` still wins in
 * production, which is exactly where it should.
 */
const portArgument = (): string | undefined => {
  const at = process.argv.indexOf('--port');
  return at >= 0 ? process.argv[at + 1] : undefined;
};

export const serverConfig: ServerConfig = {
  port: int(portArgument() ?? process.env['PORT'], DEFAULT_SERVER_PORT),
  host: process.env['HOST'] ?? '0.0.0.0',
  tickRate: SERVER_TICK_RATE,
  patchRateMs: 1000 / SERVER_TICK_RATE,
  // Relative to the server package, which is the working directory for both
  // `npm run dev` and `npm start`, so a restart finds the same file either way.
  dataDir: resolve(process.env['MOONWALK_DATA_DIR'] ?? 'data'),
  // Baked into the image by the deploy workflow. Without it there is no way to
  // tell which commit a running container is, which is exactly how a server
  // sat six deploys behind its client without anybody being able to see it.
  buildVersion: (process.env['MOONWALK_BUILD'] ?? 'unknown').slice(0, 40),
  buxWebhookSecret: process.env['BLOXITY_WEBHOOK_SECRET'] ?? '',
  buxAllowUnsigned: process.env['BLOXITY_WEBHOOK_ALLOW_UNSIGNED'] === '1',
  bloxityApiBase: (process.env['BLOXITY_API_BASE'] ?? 'https://api.bloxity.io').replace(/\/+$/, ''),
};
