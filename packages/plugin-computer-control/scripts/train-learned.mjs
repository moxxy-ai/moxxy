// Runs the training cases (`learned/cases/*.json`) on this computer's real apps and adds what they taught to the
// lessons that ship with the plugin (`learned/`). Run before a release, on a machine in the cases' language,
// with the apps installed and hands off the keyboard and mouse.
// usage: TYPESAFE_API_KEY=… pnpm --filter @moxxy/plugin-computer-control learned:train [app-id …] [--passes 2]
import { randomUUID } from 'node:crypto';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

if (!process.env.TYPESAFE_API_KEY) {
  console.error('TYPESAFE_API_KEY is not set: the cases are found on screen by Jev.');
  process.exit(1);
}
const args = process.argv.slice(2);
const at = args.indexOf('--passes');
const passes = at >= 0 ? Number(args[at + 1]) : 2;
const wanted = new Set(args.filter((arg, index) => !arg.startsWith('--') && (at < 0 || index !== at + 1)).map((app) => app.toLowerCase()));

// Lessons of this training only: nothing this computer learned in everyday use gets shipped.
const home = mkdtempSync(join(tmpdir(), 'moxxy-train-'));
process.env.MOXXY_HOME = home;
const { default: plugin } = await import('../dist/index.js');
const { parseCases, train } = await import('../dist/jev/train.js');
const { promote, shippedLearned } = await import('../dist/jev/memory.js');

const directory = fileURLToPath(new URL('../learned/cases', import.meta.url));
const files = readdirSync(directory).filter((file) => file.endsWith('.json'))
  .map((file) => parseCases(JSON.parse(readFileSync(join(directory, file), 'utf8'))))
  .filter((file) => wanted.size === 0 || wanted.has(file.app.toLowerCase()));

const tool = (name) => plugin.tools.find((candidate) => candidate.name === name);
const quiet = () => undefined;
let failed = 0;
for (const file of files) {
  const events = [];
  const log = { get length() { return events.length; }, at: (seq) => events[seq], slice: (from, to) => events.slice(from, to), ofType: (type) => events.filter((event) => event.type === type), byTurn: (turnId) => events.filter((event) => event.turnId === turnId), toJSON: () => events };
  const context = { sessionId: randomUUID(), turnId: randomUUID(), callId: 'train', cwd: process.cwd(), signal: AbortSignal.timeout(30 * 60_000), log, logger: { debug: quiet, info: quiet, warn: quiet, error: quiet } };
  const record = (type, fields) => events.push({ id: `e${events.length}`, seq: events.length, ts: Date.now(), sessionId: context.sessionId, turnId: context.turnId, source: 'system', type, ...fields });
  const call = (name, input) => tool(name).handler(tool(name).inputSchema.parse(input), context);
  try {
    // The trainer is the one at the controls: full access to the app under training.
    const request = { apps: [file.app], reason: 'Train the lessons that ship with moxxy', full_access: [file.app] };
    record('tool_call_requested', { callId: 'grant', name: 'computer_request_access', input: request });
    record('tool_call_approved', { callId: 'grant', decidedBy: 'resolver', mode: 'allow', decidedNow: true });
    record('tool_result', { callId: 'grant', ok: true, output: await call('computer_request_access', request) });
    const results = await train(file, passes, async (input) => {
      const output = await call('computer_run', input);
      return typeof output === 'string' ? output : output.forModel ?? '';
    });
    console.log(`\n${file.app}`);
    for (const result of results) {
      if (!result.done) failed += 1;
      console.log(`  pass ${result.pass}  ${result.done ? 'done  ' : 'FAILED'}  ${result.seconds ?? '-'} s  ${result.asked ?? '-'} Jev  ${result.goal}${result.why ? `  (${result.why})` : ''}`);
    }
  } finally {
    await plugin.hooks.onShutdown(context);
  }
}

const apps = await promote(join(home, 'computer-use', 'learned'), shippedLearned);
rmSync(home, { recursive: true, force: true });
console.log(apps.length === 0 ? '\nNothing new was learned.' : `\nShipped lessons updated for: ${apps.join(', ')}\nRead the diff of ${shippedLearned} before committing: targets and routes are stored as written.`);
process.exit(failed > 0 ? 1 : 0);
