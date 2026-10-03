// What one browser trial cost: model calls and tokens, tool calls (and how many would have asked the user), failures.
// usage: node apps/desktop/scripts/browser-trial/summarize.mjs <trial dir>
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** The desktop's browser tools that ask without --allow-all; the rest act under the site's consent. */
const ASKING = new Set(['browser_allow_site', 'browser_dialog', 'browser_session']);

const s = (ms) => `${(ms / 1000).toFixed(1)}s`;
const sum = (values) => values.reduce((total, value) => total + (value ?? 0), 0);

export function summarize(dir) {
  const read = (name) => (existsSync(join(dir, name)) ? readFileSync(join(dir, name), 'utf8') : '');
  const events = JSON.parse(read('events.json') || '[]');
  const responses = events.filter((event) => event.type === 'provider_response');
  const calls = events.filter((event) => event.type === 'tool_call_requested');
  const results = new Map(events.filter((event) => event.type === 'tool_result').map((event) => [event.callId, event]));
  const counted = {};
  for (const call of calls) counted[call.name] = (counted[call.name] ?? 0) + 1;
  const failed = calls.filter((call) => results.get(call.callId)?.ok === false);
  const asking = calls.filter((call) => ASKING.has(call.name));
  const answer = events.filter((event) => event.type === 'assistant_message').at(-1);
  return [
    read('exit.txt').trim(),
    `model: ${responses.length} calls, ${s(sum(responses.map((r) => r.timing?.providerWaitMs)))}, tokens in ${sum(responses.map((r) => r.inputTokens))} (cached ${sum(responses.map((r) => r.cacheReadTokens))}) out ${sum(responses.map((r) => r.outputTokens))}`,
    `tools: ${calls.length} calls, ${asking.length} would ask — ${Object.entries(counted).sort((a, b) => b[1] - a[1]).map(([name, count]) => `${name}×${count}`).join(' ')}`,
    ...failed.map((call) => `failed ${call.name}: ${(results.get(call.callId)?.error?.message ?? '').replace(/\s+/g, ' ').slice(0, 200)}`),
    `answer: ${(answer?.content ?? '(none)').replace(/\s+/g, ' ').slice(0, 600)}`,
  ].filter(Boolean).join('\n');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (!process.argv[2]) {
    console.error('usage: summarize.mjs <trial dir>');
    process.exit(64);
  }
  console.log(summarize(process.argv[2]));
}
