/**
 * Events command: tail SSE stream.
 */
import { createSseClient } from '../sse-client.js';
import { parseFlags } from './auth.js';
import { isInteractive, handleCancel, pickAgent, p } from '../ui.js';

export async function runEvents(client, args) {
  let [action, ...rest] = args;

  // Default to 'tail' in interactive mode when no action
  if (!action && isInteractive()) {
    action = 'tail';
  }

  if (action !== 'tail') {
    const { showHelp } = await import('../help.js');
    showHelp('events', p);
    return;
  }

  const flags = parseFlags(rest);
  const filters = {};

  // Interactive filter wizard when no filters provided
  if (!flags.agent && !flags.run && isInteractive()) {
    const filterMode = await p.select({
      message: 'Event filter',
      options: [
        { value: 'all',   label: 'All events',  hint: 'stream all events' },
        { value: 'agent', label: 'By agent',     hint: 'filter by specific agent' },
      ],
    });
    handleCancel(filterMode);

    if (filterMode === 'agent') {
      const agentId = await pickAgent(client, 'Select agent to tail');
      filters.agent_id = agentId;
    }
  } else {
    if (flags.agent) filters.agent_id = flags.agent;
    if (flags.run) filters.run_id = flags.run;
  }

  const sse = createSseClient(client.baseUrl, client.token, filters);

  if (isInteractive()) {
    p.log.info(`Connecting to ${sse.url} ...`);
  } else {
    console.error(`Connecting to ${sse.url} ...`);
  }

  process.on('SIGINT', () => {
    sse.disconnect();
    if (isInteractive()) {
      p.log.info('Disconnected.');
    } else {
      console.error('\nDisconnected.');
    }
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
