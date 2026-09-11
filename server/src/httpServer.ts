import { createServer, type Server } from 'node:http';
import { ROOM_NAME } from '@moonwalk/shared';

/**
 * A plain HTTP server for Colyseus to attach to.
 *
 * Owning it rather than letting Colyseus make its own means the same port
 * answers both the WebSocket upgrade and a `/health` probe - which is what a
 * managed host polls to decide the service is up.
 *
 * That probe is the ONLY route. There is no webhook and no other endpoint:
 * this build has no payment, portal or cloud integration at all, and an
 * endpoint that exists before anything needs it is an endpoint nobody is
 * checking the authentication on.
 */
export const createHttpServer = (): Server =>
  createServer((request, response) => {
    if (request.url === '/health') {
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ ok: true, room: ROOM_NAME }));
      return;
    }

    response.writeHead(404, { 'Content-Type': 'text/plain' });
    response.end('not found');
  });
