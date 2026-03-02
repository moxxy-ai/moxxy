/**
 * Events command: tail SSE stream.
 */
import { SseConsumer } from '../sse-consumer.js';
import { parseFlags } from './auth.js';

/**
 * Tail the SSE event stream.
 */
export async function eventsTail(client, args) {
  const flags = parseFlags(args);
  const filters = {};
  if (flags.agent) filters.agent_id = flags.agent;
  if (flags.run) filters.run_id = flags.run;

  const url = client.eventStreamUrl(filters);
  const consumer = new SseConsumer(url, client.token);

  console.error(`Connecting to ${url} ...`);

  consumer.onEvent((event) => {
    if (flags.json === 'true') {
      console.log(JSON.stringify(event));
    } else {
      const ts = event.ts ? new Date(event.ts).toISOString() : '?';
      const type = event.event_type || 'unknown';
      const agent = event.agent_id || '-';
      console.log(`[${ts}] ${type} agent=${agent} ${JSON.stringify(event.payload || {})}`);
    }
  });

  consumer.onError((err) => {
    console.error(`SSE error: ${err.message}`);
    process.exitCode = 1;
  });

  // Handle Ctrl+C gracefully
  process.on('SIGINT', () => {
    consumer.disconnect();
    console.error('\nDisconnected.');
    process.exit(0);
  });

  await consumer.connect();
}

/**
 * Route events subcommands.
 */
export async function eventsCommand(client, args) {
  const sub = args[0];
  const rest = args.slice(1);

  switch (sub) {
    case 'tail':
      return eventsTail(client, rest);
    default:
      console.error('Usage: moxxy events tail [--agent <id>] [--run <id>]');
      process.exitCode = 1;
  }
}
