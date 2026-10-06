#!/usr/bin/env node
// Compares the two preview streams of the macOS helper on the fixture app: helper CPU time, bytes
// sent and how long a change takes to arrive. Nothing here takes the pointer or the keyboard.
//   node measure-preview.mjs [seconds per codec] [file for the H.264 chunks as JSON]
import { spawn, spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline';

const VERSION = 5;
const APP = 'ai.moxxy.computer-fixture';
const seconds = Number(process.argv[2] ?? 15);
const helperPath = fileURLToPath(new URL('../../bin/darwin-universal/moxxy-computer', import.meta.url));
const helper = spawn(helperPath, ['--parent', String(process.pid)], { stdio: ['pipe', 'pipe', 'inherit'] });
const pending = new Map();
let onEvent = () => undefined;
createInterface({ input: helper.stdout }).on('line', (line) => {
  const frame = JSON.parse(line);
  if (frame.event) return onEvent(frame, line.length);
  const waiting = pending.get(frame.id);
  pending.delete(frame.id);
  if (frame.ok) waiting.resolve(frame.result);
  else waiting.reject(new Error(`${frame.error.code}: ${frame.error.message}`));
});
let next = 0;
const request = (method, params = {}) => new Promise((resolve, reject) => {
  const id = `m${next++}`;
  pending.set(id, { resolve, reject });
  helper.stdin.write(JSON.stringify({ version: VERSION, id, method, params }) + '\n');
});
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
/** CPU seconds the helper has used so far (user + system). */
const cpu = () => {
  const [minutes, rest] = spawnSync('ps', ['-o', 'time=', '-p', String(helper.pid)]).stdout.toString().trim().split(':');
  return Number(minutes) * 60 + Number(rest);
};

const state = await request('get_app_state', { app: APP, screenshot: false });
const field = state.tree.elements.find((element) => element.key.endsWith('text field:name'));
if (!field) throw new Error('The fixture app is not built; run native/macos/build-fixture.sh');
const chunks = [];
const results = [];
for (const codec of ['jpeg', 'h264']) {
  let pictures = 0, bytes = 0, changedAt = 0;
  const delays = [];
  onEvent = (event, size) => {
    const picture = event.event === 'preview_chunk' || (event.event === 'preview_frame' && event.image);
    if (!picture) return;
    pictures += 1;
    bytes += size;
    if (changedAt) { delays.push(performance.now() - changedAt); changedAt = 0; }
    if (event.event === 'preview_chunk' && chunks.length < 40) chunks.push(event);
  };
  await request('preview.start', { fps: 5, codec });
  await sleep(1500);
  pictures = 0; bytes = 0;
  const before = cpu();
  const started = performance.now();
  for (let step = 0; performance.now() - started < seconds * 1000; step += 1) {
    // From asking for the change to the first picture after it.
    changedAt = performance.now();
    await request('act', { app: APP, allowed: [APP], action: { action: 'set_value', element_index: field.index, value: `preview ${codec} ${step}` } });
    await sleep(400);
  }
  const elapsed = (performance.now() - started) / 1000;
  const used = cpu() - before;
  await request('preview.stop');
  await sleep(500);
  delays.sort((a, b) => a - b);
  results.push({
    codec, seconds: Number(elapsed.toFixed(1)), pictures, kilobytesPerSecond: Number((bytes / 1024 / elapsed).toFixed(1)),
    helperCpuPercent: Number((used / elapsed * 100).toFixed(1)), medianDelayMs: Math.round(delays[Math.floor(delays.length / 2)] ?? NaN),
  });
}
console.table(results);
if (process.argv[3]) writeFileSync(process.argv[3], JSON.stringify(chunks.map(({ key, codec, data, timestamp, width, height }) => ({ key, codec, data, timestamp, width, height }))));
helper.stdin.end();
spawnSync('pkill', ['-x', 'MoxxyComputerFixture']);
