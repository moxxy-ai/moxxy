// What one live trial of Computer Use cost and where its time went.
// A trial is `moxxy -p "<task>" --allow-all --output-format json > <dir>/events.json`, run with
// MOXXY_JEV_TRACE=<dir>/jev.ndjson and MOXXY_COMPUTER_TIMING=<dir>/helper-timing.ndjson.
// usage: pnpm --filter @moxxy/plugin-computer-control trial:summarize <dir>
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const dir = process.argv[2];
if (!dir) {
  console.error('usage: summarize-trial.mjs <trial directory>');
  process.exit(64);
}
const read = (name) => (existsSync(join(dir, name)) ? readFileSync(join(dir, name), 'utf8') : '');
const lines = (name) => read(name).trim().split('\n').filter(Boolean).map((line) => JSON.parse(line));
const s = (ms) => `${(ms / 1000).toFixed(1)}s`;
const sum = (values) => values.reduce((total, value) => total + value, 0);
const avg = (values) => (values.length ? Math.round(sum(values) / values.length) : 0);

const events = JSON.parse(read('events.json') || '[]');
const responses = events.filter((event) => event.type === 'provider_response');
const calls = events.filter((event) => event.type === 'tool_call_requested');
const results = new Map(events.filter((event) => event.type === 'tool_result').map((event) => [event.callId, event]));
const turn = (events.at(-1)?.ts ?? 0) - (events[0]?.ts ?? 0);
const modelMs = sum(responses.map((response) => response.timing?.providerWaitMs ?? 0));
const toolMs = sum(calls.map((call) => (results.get(call.callId)?.ts ?? call.ts) - call.ts));
console.log(`turn ${s(turn)} | model: ${responses.length} calls, ${s(modelMs)} | tools: ${calls.length} calls, ${s(toolMs)}`);
const counted = {};
for (const call of calls) counted[call.name] = (counted[call.name] ?? 0) + 1;
console.log(`tools: ${Object.entries(counted).sort((a, b) => b[1] - a[1]).map(([name, count]) => `${name}×${count}`).join(' ')}`);

const text = (output) => {
  if (typeof output === 'string') return output;
  const parts = Array.isArray(output) ? output : Array.isArray(output?.content) ? output.content : [output];
  return parts.map((part) => (typeof part === 'string' ? part : part?.text ?? part?.forModel ?? '')).join('\n');
};
const traced = lines('jev.ndjson');
const runs = traced.filter((line) => line.run).map((line) => line.run);
for (const [index, call] of calls.filter((candidate) => candidate.name === 'computer_run').entries()) {
  const result = results.get(call.callId);
  const report = result ? text(result.output).split('\n').filter((line) => /^computer_run:|^\d+\. |^Not run/.test(line)).join('\n    ') : '(no result)';
  const time = runs[index]?.time;
  const split = time ? ` [jev ${s(time.jev)}, actions ${s(time.act)}, looks ${s(time.look)}]` : '';
  console.log(`run ${index + 1} (${call.input.app}, ${call.input.steps.length} steps)${split}: ${call.input.goal}\n    ${report}`);
}

const asks = traced.filter((line) => !line.run);
if (asks.length > 0) {
  console.log(`jev: ${asks.length} requests, avg ${avg(asks.map((ask) => ask.ms))} ms, avg ${avg(asks.map((ask) => ask.elements))} elements, errors ${asks.filter((ask) => ask.error).length}`);
}
if (runs.length > 0) {
  const part = (name) => s(sum(runs.map((run) => run.time[name])));
  console.log(`computer_run total: ${s(sum(runs.map((run) => run.ms)))} = jev ${part('jev')} + actions ${part('act')} + looks ${part('look')} + code`);
}

// Helper marks: the time since the mark before, by what the helper was doing. `begin` marks are the gaps between requests.
const phases = new Map();
for (const line of read('helper-timing.ndjson').split('\n')) {
  const mark = /^\s*(-?\d+) ms\s+(.+)$/.exec(line);
  if (!mark || /: begin$/.test(mark[2])) continue;
  const phase = phases.get(mark[2]) ?? { ms: 0, count: 0 };
  phases.set(mark[2], { ms: phase.ms + Number(mark[1]), count: phase.count + 1 });
}
if (phases.size > 0) {
  const sorted = [...phases].sort((a, b) => b[1].ms - a[1].ms);
  console.log(`helper ${s(sum(sorted.map(([, phase]) => phase.ms)))}: ${sorted.slice(0, 6).map(([name, phase]) => `${name} ${s(phase.ms)}×${phase.count}`).join(', ')}`);
}
const answer = events.filter((event) => event.type === 'assistant_message').at(-1);
console.log(`answer: ${(answer?.content ?? '(none)').replace(/\s+/g, ' ').slice(0, 900)}`);
