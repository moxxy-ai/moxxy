import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { removeDir } from '@moxxy/vitest-preset/fs';
import { readIndex, readSessionMeta } from './persistence.js';

// `readSessionMeta` answers "what does the index say about THIS session" for the
// boot path that opens one conversation. It must give exactly the row
// `readIndex` gives for that id, so every case `readIndex` handles is here.

const tempDirs: string[] = [];
afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => removeDir(dir)));
});

async function makeTempDir(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'moxxy-read-one-'));
  tempDirs.push(dir);
  return dir;
}

function sidecar(id: string, fields: Record<string, unknown> = {}): string {
  return JSON.stringify({
    version: 1,
    id,
    cwd: '/tmp/project',
    startedAt: '2026-11-16T00:00:00.000Z',
    lastActivity: '2026-11-16T00:00:01.000Z',
    eventCount: 0,
    firstPrompt: null,
    provider: null,
    model: null,
    ...fields,
  });
}

function event(sessionId: string | undefined, seq: number, fields: Record<string, unknown>): string {
  return JSON.stringify({
    id: `e${seq}`,
    seq,
    ts: seq,
    ...(sessionId === undefined ? {} : { sessionId }),
    turnId: 't1',
    source: 'system',
    ...fields,
  });
}

/** Every shape the index reader distinguishes, side by side in one folder. */
async function writeCorpus(dir: string): Promise<string[]> {
  const files: Record<string, string> = {
    // A plain session whose log refreshes provider/model and first prompt.
    'PLAIN.json': sidecar('PLAIN', { eventCount: 1, provider: 'old', model: 'old-model' }),
    'PLAIN.jsonl':
      [
        event('PLAIN', 0, { type: 'user_prompt', text: 'Zażółć gęślą jaźń 🚀 '.repeat(8) }),
        event('PLAIN', 1, { type: 'provider_request', provider: 'p1', model: 'm1' }),
        '{"broken json',
        JSON.stringify({ not: 'an event' }),
        event('PLAIN', 2, { type: 'provider_response', provider: 'p2', model: 'm2', inputTokens: 1, outputTokens: 1 }),
      ].join('\n') + '\n',
    // Canonical and legacy sidecars for the same id: the canonical one wins.
    'DUP.meta.json': sidecar('DUP', { title: 'legacy', eventCount: 3 }),
    'DUP.json': sidecar('DUP', { title: 'canonical', eventCount: 2 }),
    'DUP.jsonl': '',
    // Only a legacy sidecar.
    'LEGACY.meta.json': sidecar('LEGACY', { eventCount: 1, firstPrompt: 'kept', provider: 'lp', model: 'lm' }),
    'LEGACY.jsonl': '',
    // A sidecar whose file name does not match the id inside it.
    'MISNAMED.json': sidecar('INNER', { eventCount: 4, provider: 'ip', model: 'im' }),
    'INNER.jsonl': event('INNER', 0, { type: 'user_prompt', text: 'inner' }) + '\n',
    // No event log: dropped from the index.
    'NOLOG.json': sidecar('NOLOG', { eventCount: 5 }),
    // A log that holds only another session's events.
    'FOREIGN.json': sidecar('FOREIGN', { eventCount: 7, firstPrompt: 'mine', provider: 'fp', model: 'fm' }),
    'FOREIGN.jsonl': event('SOMEONE-ELSE', 0, { type: 'user_prompt', text: 'not mine' }) + '\n',
    // Events without a session id belong to the session; no trailing newline.
    'UNSTAMPED.json': sidecar('UNSTAMPED'),
    'UNSTAMPED.jsonl': event(undefined, 0, { type: 'user_prompt', text: 'unstamped' }),
    // CRLF line endings.
    'CRLF.json': sidecar('CRLF'),
    'CRLF.jsonl': [event('CRLF', 0, { type: 'user_prompt', text: 'crlf' }), ''].join('\r\n'),
    // A corrupt sidecar and the shared legacy index are not rows.
    'CORRUPT.json': '{"id":',
    'CORRUPT.jsonl': '',
    'index.json': JSON.stringify([{ id: 'FROM-INDEX' }]),
  };
  for (const [name, content] of Object.entries(files)) {
    await fs.writeFile(path.join(dir, name), content, 'utf8');
  }
  return ['PLAIN', 'DUP', 'LEGACY', 'INNER', 'MISNAMED', 'NOLOG', 'FOREIGN', 'UNSTAMPED', 'CRLF', 'CORRUPT', 'FROM-INDEX', 'MISSING'];
}

describe('readSessionMeta', () => {
  it('returns exactly the readIndex row for every id, or null when readIndex has none', async () => {
    const dir = await makeTempDir();
    const ids = await writeCorpus(dir);
    const index = await readIndex(dir);

    for (const id of ids) {
      const expected = index.find((row) => row.id === id) ?? null;
      expect({ id, row: await readSessionMeta(id, dir) }).toEqual({ id, row: expected });
    }
  });

  it('returns null for a folder that does not exist', async () => {
    const dir = path.join(await makeTempDir(), 'never-created');
    await expect(readSessionMeta('ANY', dir)).resolves.toBeNull();
  });
});
