// A scripted native helper for backend tests: speaks the shared JSON-lines
// protocol over stdio and models three apps in memory. `--log <file>` records
// every request so tests can prove a refused action never reached the helper.
import { appendFileSync } from 'node:fs';
import { createInterface } from 'node:readline';

const VERSION = 5;
const logIndex = process.argv.indexOf('--log');
const logFile = logIndex > 0 ? process.argv[logIndex + 1] : undefined;
// External OS boundary: reproduce blocked and unknown-delivery replies without
// revoking the developer's real permissions or taking over their desktop.
const actionResultIndex = process.argv.indexOf('--action-result');
const actionResult = actionResultIndex > 0 ? JSON.parse(process.argv[actionResultIndex + 1]) : undefined;
const incompleteBatch = process.argv.includes('--incomplete-batch');
const PNG = 'iVBORw0KGgo=';

const apps = [
  { id: 'com.apple.TextEdit', name: 'TextEdit', running: true, also: 'text editor' },
  { id: 'com.apple.Safari', name: 'Safari', running: false },
  { id: 'com.apple.Terminal', name: 'Terminal', running: true },
  { id: 'com.example.notes.one', name: 'Notes', running: false },
  { id: 'com.example.notes.two', name: 'Notes', running: false },
];
const documents = new Map(apps.map((app) => [app.id, 'hello']));

function tree(id) {
  const app = apps.find((candidate) => candidate.id === id);
  return {
    app: app.name, window: 'Untitled',
    elements: [
      { key: 'w', index: 0, depth: 0, role: 'window', title: 'Untitled' },
      { key: 'w/text', index: 1, depth: 1, role: 'text area', value: documents.get(id), states: ['focused'] },
      { key: 'w/save', index: 2, depth: 1, role: 'button', title: 'Save', actions: ['AXPress'] },
      { key: 'w/broken', index: 3, depth: 1, role: 'button', title: 'Broken' },
      // A helper bug the contract must catch: two elements under one key.
      ...(documents.get(id).includes('<twins>') ? [{ key: 'w/broken', index: 4, depth: 1, role: 'button', title: 'Twin' }] : []),
    ],
  };
}

/** Clicks on Save in a document holding `<hover>`: each lights the button up anew, which only the picture shows. */
let highlights = 0;

const state = (id, screenshot = true) => ({
  tree: tree(id),
  ...(screenshot ? { screenshot: { mediaType: 'image/png', base64: `${PNG}${'A'.repeat(highlights)}`, width: 800, height: 600 } } : {}),
  // The system's open or save panel is what the app shows.
  ...(documents.get(id).includes('<file-panel>') ? { filePanel: true } : {}),
});

class Refusal extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

let stubborn = 0;

function perform(app, step) {
  if (actionResult && !['timeout', 'helper_failed'].includes(actionResult.code)) return actionResult;
  if (step.action === 'click' && step.element_index === 3) return { outcome: 'blocked', code: 'target_blocked' };
  // A control the helper itself gives up on once it is asked for it a second time.
  if (step.action === 'click' && step.element_index === 4) return (stubborn += 1) > 1 ? { outcome: 'ineffective', hint: 'A real click changed nothing either.' } : { outcome: 'delivered', method: 'ax' };
  if (step.action === 'type_text') documents.set(app, documents.get(app) + step.text);
  if (actionResult) return actionResult;
  if (step.action === 'click' && step.element_index === 2 && documents.get(app).includes('<hover>')) highlights += 1;
  return { outcome: 'delivered', method: 'ax' };
}

function requireAllowed(params) {
  if (!params.allowed.includes(params.app)) throw new Refusal('app_not_allowed', `${params.app} is not granted`);
}

const methods = {
  status: () => ({
    ready: false, permissions: { accessibility: true, screenRecording: false },
    limitations: ['Screen Recording is not allowed: the helper cannot capture windows.'],
  }),
  'permissions.request': () => ({ opened: true }),
  // Like the native helper: capture answers at once and frames follow as events.
  'preview.start': ({ fps, codec }) => {
    const image = { mediaType: 'image/jpeg', base64: `frame@${fps}`, width: 640, height: 400 };
    const chunk = { seq: 1, key: true, codec: 'avc1.4d001f', data: 'dmlkZW8=', timestamp: 0, width: 640, height: 400 };
    const event = codec === 'h264' ? { event: 'preview_chunk', ...chunk } : { event: 'preview_frame', seq: 1, image };
    setImmediate(() => process.stdout.write(JSON.stringify({ version: VERSION, ...event }) + '\n'));
    return { started: true };
  },
  'preview.keyframe': () => ({ requested: true }),
  'preview.stop': () => ({ stopped: true }),
  list_apps: ({ query, limit }) => {
    const matching = apps.filter((app) => !query || `${app.name} ${app.id}`.toLowerCase().includes(query.toLowerCase()));
    return { apps: matching.slice(0, limit).map(({ also, ...app }) => app), truncated: matching.length > limit };
  },
  resolve_apps: ({ names }) => ({
    apps: names.map((request) => {
      const found = apps.filter((app) => [app.id, app.name, app.also ?? ''].some((name) => name.toLowerCase() === request.toLowerCase()));
      if (found.length === 0) return { request, status: 'not_found' };
      if (found.length > 1) return { request, status: 'ambiguous', candidates: found.map(({ id, name }) => ({ id, name })) };
      return { request, status: 'resolved', id: found[0].id, name: found[0].name };
    }),
  }),
  get_app_state: ({ app, screenshot, web }) => {
    // A browser whose page has not reached accessibility yet.
    if (web) return { ...state(app, screenshot), contentPending: true };
    if (app === 'com.apple.Terminal') throw new Refusal('permissions_not_granted', 'Accessibility is off');
    // Like the native helper: the cursor appears over the observed window before the answer.
    process.stdout.write(JSON.stringify({ version: VERSION, event: 'cursor', cursor: { phase: 'idle', x: 0.5, y: 0.5 } }) + '\n');
    return state(app, screenshot);
  },
  act: (params) => {
    requireAllowed(params);
    return { result: perform(params.app, params.action), state: state(params.app, params.screenshot !== false) };
  },
  batch: (params) => {
    requireAllowed(params);
    const results = [];
    for (const step of params.actions) {
      const result = perform(params.app, step);
      results.push(result);
      if (result.outcome !== 'delivered') break;
    }
    return { results: incompleteBatch ? results.slice(0, 1) : results, state: state(params.app, params.screenshot !== false) };
  },
  screenshot: () => ({ mediaType: 'image/png', base64: PNG, width: 1440, height: 900 }),
  zoom: () => ({ mediaType: 'image/png', base64: PNG, width: 400, height: 200 }),
  // A control the screenshot shows under a name accessibility does not give it.
  read_text: (params) => {
    requireAllowed(params);
    return { lines: [{ text: 'Publish', x: 300, y: 40, width: 60, height: 20 }] };
  },
};

const lines = createInterface({ input: process.stdin });
lines.on('line', (line) => {
  const frame = JSON.parse(line);
  if (frame.control) return;
  if (logFile) appendFileSync(logFile, JSON.stringify({ method: frame.method, params: frame.params }) + '\n');
  const reply = (body) => process.stdout.write(JSON.stringify({ version: VERSION, id: frame.id, ...body }) + '\n');
  try {
    const handler = methods[frame.method];
    if (!handler) throw new Refusal('unsupported_action', `unknown method ${frame.method}`);
    reply({ ok: true, result: handler(frame.params) });
  } catch (error) {
    reply({ ok: false, error: { code: error.code ?? 'helper_failed', message: error.message } });
  }
});
lines.on('close', () => process.exit(0));
