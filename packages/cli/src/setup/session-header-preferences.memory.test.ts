import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { afterAll, describe, expect, it } from 'vitest';
import { removeDirSync } from '@moxxy/vitest-preset/fs';

// Opening one conversation must not read every other conversation's history.
// Before the fix, restoring the opened conversation's model read the whole
// event log of every saved session (32 at a time), so an owner with a few GiB
// of history crashed `moxxy serve` out of memory on every start. The check runs
// in a child process with a small heap, the same way the crash happened.

const CLI_DIR = path.resolve(__dirname, '..', '..');
const OTHER_SESSIONS = 16;
const OTHER_LOG_BYTES = 12 * 1024 * 1024;
const CHILD_HEAP_MIB = 160;

const home = mkdtempSync(path.join(os.tmpdir(), 'moxxy-open-one-session-'));
afterAll(() => removeDirSync(home));

describe('applySessionHeaderPreferences with many large saved sessions', () => {
  it('restores the opened session without reading the other sessions', () => {
    const sessionsDir = path.join(home, 'sessions');
    mkdirSync(sessionsDir, { recursive: true });
    const openedId = '01OPENEDSESSION0000000000';
    writeSidecar(sessionsDir, openedId, { provider: 'session-provider', model: 'session-model', eventCount: 1 });
    writeFileSync(
      path.join(sessionsDir, `${openedId}.jsonl`),
      JSON.stringify({ seq: 0, id: 'e0', type: 'user_prompt', sessionId: openedId, ts: '2026-11-16T00:00:00.000Z', text: 'hello' }) + '\n',
    );
    for (let i = 0; i < OTHER_SESSIONS; i += 1) {
      const id = `01OTHERSESSION${String(i).padStart(11, '0')}`;
      writeSidecar(sessionsDir, id, { provider: 'other', model: 'other', eventCount: 1 });
      writeFileSync(path.join(sessionsDir, `${id}.jsonl`), largeLog(id));
    }

    const script = path.join(home, 'open-one-session.mts');
    writeFileSync(script, childScript(openedId));
    const tsx = pathToFileURL(realpathSync(path.join(CLI_DIR, 'node_modules', 'tsx', 'dist', 'esm', 'index.mjs'))).href;
    const run = spawnSync(
      process.execPath,
      [`--max-old-space-size=${CHILD_HEAP_MIB}`, '--import', tsx, script],
      { cwd: CLI_DIR, env: { ...process.env, MOXXY_HOME: home }, encoding: 'utf8', timeout: 60_000 },
    );

    expect(run.stderr).not.toMatch(/heap out of memory/i);
    expect({ status: run.status, signal: run.signal }).toEqual({ status: 0, signal: null });
    expect(JSON.parse(run.stdout.trim())).toEqual({
      provider: 'session-provider',
      model: 'session-model',
    });
  }, 90_000);
});

function writeSidecar(
  dir: string,
  id: string,
  fields: { provider: string; model: string; eventCount: number },
): void {
  writeFileSync(
    path.join(dir, `${id}.json`),
    JSON.stringify({
      version: 1,
      id,
      cwd: '/tmp/project',
      startedAt: '2026-11-16T00:00:00.000Z',
      lastActivity: '2026-11-16T00:00:01.000Z',
      firstPrompt: 'hello',
      ...fields,
    }),
  );
}

/** A log shaped like the real heavy ones: mostly big tool results. */
function largeLog(sessionId: string): string {
  const output = 'x'.repeat(64 * 1024);
  const lines: string[] = [];
  let bytes = 0;
  for (let seq = 0; bytes < OTHER_LOG_BYTES; seq += 1) {
    const line =
      JSON.stringify({ seq, id: `e${seq}`, type: 'tool_result', sessionId, ts: '2026-11-16T00:00:00.000Z', callId: `c${seq}`, output }) + '\n';
    lines.push(line);
    bytes += line.length;
  }
  return lines.join('');
}

function childScript(openedId: string): string {
  const moduleUrl = pathToFileURL(path.join(CLI_DIR, 'src', 'setup', 'session-header-preferences.ts')).href;
  const coreUrl = pathToFileURL(realpathSync(path.join(CLI_DIR, 'node_modules', '@moxxy', 'core', 'dist', 'index.js'))).href;
  const sdkUrl = pathToFileURL(realpathSync(path.join(CLI_DIR, 'node_modules', '@moxxy', 'sdk', 'dist', 'index.js'))).href;
  return `
import { applySessionHeaderPreferences } from ${JSON.stringify(moduleUrl)};
import { Session, silentLogger } from ${JSON.stringify(coreUrl)};
import { definePlugin, defineProvider } from ${JSON.stringify(sdkUrl)};

const provider = (name, ids) => {
  const models = ids.map((id) => ({ id }));
  return defineProvider({
    name,
    models,
    createClient: () => ({ name, models, stream: async function* () {}, countTokens: async () => 0 }),
  });
};
const session = new Session({ cwd: '/tmp/project', logger: silentLogger });
session.pluginHost.registerStatic(definePlugin({
  name: '@test/open-one-session',
  version: '0.0.0',
  providers: [provider('global-provider', ['global-model']), provider('session-provider', ['session-model'])],
}));
session.providers.setActive('global-provider');
await applySessionHeaderPreferences(session, ${JSON.stringify(openedId)}, async () => ({}), silentLogger);
process.stdout.write(JSON.stringify({ provider: session.providers.getActiveName(), model: session.lastResolvedModel }) + '\\n');
await session.close();
`;
}
