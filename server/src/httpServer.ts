import { createServer, type IncomingMessage, type Server } from 'node:http';
import { PROTOCOL_VERSION, ROOM_NAME } from '@moonwalk/shared';
import { buxGrants } from './bloxity/buxGrantsStore.js';
import { BUX_WEBHOOK_PATH, processBuxWebhook } from './bloxity/buxWebhook.js';
import { serverConfig } from './config/serverConfig.js';
import { logger } from './util/logger.js';

const SCOPE = 'http';

/** Read a body with a ceiling, so a stuck socket cannot grow without bound. */
const readBody = async (request: IncomingMessage): Promise<string | null> => {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = chunk as Buffer;
    size += buffer.length;
    if (size > 64 * 1024) return null;
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString('utf8');
};

/**
 * A plain HTTP server for Colyseus to attach to.
 *
 * Two routes. `/health` is what the host polls. `/bloxity/bux` is Bloxity's
 * server-to-server Bux fulfilment webhook - the ONLY way a purchase becomes
 * Wins; nothing the client reports about a purchase is trusted.
 */
export const createHttpServer = (): Server =>
  createServer((request, response) => {
    const url = (request.url ?? '').split('?')[0];

    if (url === '/health') {
      // Readable from anywhere: it carries a build number and nothing else,
      // and an operator checking it from a browser tab on another origin is
      // exactly who it is for.
      response.writeHead(200, {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      });
      /*
       * The VERSION and the PROTOCOL, not just "ok".
       *
       * A health check that only says "up" cannot answer the question that
       * actually costs days: which commit is this, and can it hear what my
       * client is about to say? The client reads `protocol` here before it
       * joins and holds back anything this server would not recognise - see
       * `PROTOCOL_VERSION`.
       */
      response.end(
        JSON.stringify({
          ok: true,
          room: ROOM_NAME,
          version: serverConfig.buildVersion,
          protocol: PROTOCOL_VERSION,
        }),
      );
      return;
    }

    if (url === BUX_WEBHOOK_PATH && request.method === 'POST') {
      void readBody(request).then((raw) => {
        const secret = request.headers['x-legion-webhook-secret'];
        const result =
          raw === null
            ? { status: 413, body: { ok: false, error: 'payload too large' } }
            : processBuxWebhook(
                typeof secret === 'string' ? secret : undefined,
                raw,
                buxGrants,
                { secret: serverConfig.buxWebhookSecret, allowUnsigned: serverConfig.buxAllowUnsigned },
              );
        if (result.status >= 400) logger.warn(SCOPE, `bux webhook refused: ${result.status} ${String(result.body['error'])}`);
        response.writeHead(result.status, { 'Content-Type': 'application/json' });
        response.end(JSON.stringify(result.body));
      });
      return;
    }

    response.writeHead(404, { 'Content-Type': 'text/plain' });
    response.end('not found');
  });
