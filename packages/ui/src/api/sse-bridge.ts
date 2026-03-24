import type { FastifyInstance } from 'fastify';
import { join } from 'node:path';

/**
 * Register SSE endpoint on the Fastify server.
 * Streams job status changes, heartbeats, and task transitions.
 */
export function registerSSEBridge(fastify: FastifyInstance, kingdomDir: string): void {
  fastify.get('/api/events', async (request, reply) => {
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'Access-Control-Allow-Origin': '*',
    });

    const { getDatabaseForPath } = await import('@kingdomos/core');
    const db = getDatabaseForPath(join(kingdomDir, 'kingdom.db'));

    let lastEventId = 0;
    const interval = setInterval(() => {
      // Poll for new events since last check
      const events = db
        .prepare('SELECT * FROM event_log WHERE id > ? ORDER BY id ASC LIMIT 50')
        .all(lastEventId) as Array<{ id: number; event_type: string; timestamp: string; job_id: string | null; task_id: string | null; details: string }>;

      for (const event of events) {
        const data = JSON.stringify({
          type: event.event_type,
          timestamp: event.timestamp,
          job_id: event.job_id,
          task_id: event.task_id,
          details: JSON.parse(event.details),
        });
        reply.raw.write(`id: ${event.id}\nevent: ${event.event_type}\ndata: ${data}\n\n`);
        lastEventId = event.id;
      }
    }, 1000);

    request.raw.on('close', () => {
      clearInterval(interval);
    });
  });
}

/**
 * Client-side SSE consumer hook for React.
 */
export function createSSEClient(baseUrl: string): EventSource {
  return new EventSource(`${baseUrl}/api/events`);
}
