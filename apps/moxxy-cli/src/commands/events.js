/**
 * Events command: tail SSE stream.
 */
import { createSseClient } from '../sse-client.js';
import { parseFlags } from './auth.js';

export async function runEvents(client, args) {
  const [action, ...rest] = args;

  if (action !== 'tail') {
    console.error('Usage: moxxy events tail [--agent <id>] [--run <id>]');
    process.exitCode = 1;
    return;
  }

  const flags = parseFlags(rest);
  const filters = {};
  if (flags.agent) filters.agent_id = flags.agent;
  if (flags.run) filters.run_id = flags.run;

  const sse = createSseClient(client.baseUrl, client.token, filters);

  console.error(`Connecting to ${sse.url} ...`);

  process.on('SIGINT', () => {
    sse.disconnect();
    console.error('\nDisconnected.');
    process.exit(0);
  });

  try {
    for await (const event of sse.stream()) {
      if (flags.json === true || flags.json === 'true') {
        console.log(JSON.stringify(event));
      } else {
        const ts = event.ts ? new Date(event.ts).toISOString() : '?';
        const type = event.event_type || 'unknown';
        const agent = event.agent_id || '-';
        console.log(`[${ts}] ${type} agent=${agent} ${JSON.stringify(event.payload || {})}`);
      }
    }
  } catch (err) {
    if (err.name !== 'AbortError') {
      console.error(`SSE error: ${err.message}`);
      process.exitCode = 1;
    }
  }
}
