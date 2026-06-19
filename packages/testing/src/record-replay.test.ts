import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { LLMProvider } from '@moxxy/sdk';
import { FakeProvider, textReply } from './fake-provider.js';
import { RecordedProvider, fixtureMode } from './record-replay.js';
import { hashRequest } from './hash.js';

let dir: string;
beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mox-fixtures-'));
});
afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

const req = () => ({
  model: 'fake',
  system: 'sys',
  messages: [{ role: 'user' as const, content: [{ type: 'text' as const, text: 'hi' }] }],
});

describe('RecordedProvider', () => {
  it('record mode writes a fixture and replay mode reads it back', async () => {
    const upstream = new FakeProvider({ script: [textReply('hi back')] });
    const recorder = new RecordedProvider({ mode: 'record', upstream, fixtureDir: dir, testName: 'demo' });
    let recorded = '';
    for await (const e of recorder.stream(req())) if (e.type === 'text_delta') recorded += e.delta;
    expect(recorded).toBe('hi back');

    const files = await fs.readdir(dir);
    expect(files).toHaveLength(1);

    const replayer = new RecordedProvider({ mode: 'replay', fixtureDir: dir, testName: 'demo' });
    let replayed = '';
    for await (const e of replayer.stream(req())) if (e.type === 'text_delta') replayed += e.delta;
    expect(replayed).toBe('hi back');
  });

  it('tracks written and read fixture paths so consumers need no mtime diff', async () => {
    const upstream = new FakeProvider({ script: [textReply('hi back')] });
    const recorder = new RecordedProvider({ mode: 'record', upstream, fixtureDir: dir, testName: 'tracked' });
    expect(recorder.writtenFixtures).toEqual([]);
    for await (const _ of recorder.stream(req())) void _;
    expect(recorder.writtenFixtures).toHaveLength(1);
    expect(recorder.writtenFixtures[0]).toContain('tracked.');
    // Nothing read in record mode.
    expect(recorder.readFixtures).toEqual([]);

    const replayer = new RecordedProvider({ mode: 'replay', fixtureDir: dir, testName: 'tracked' });
    for await (const _ of replayer.stream(req())) void _;
    expect(replayer.readFixtures).toHaveLength(1);
    expect(replayer.readFixtures[0]).toBe(recorder.writtenFixtures[0]);
    // The replayer wrote nothing.
    expect(replayer.writtenFixtures).toEqual([]);
  });

  it('does not record a written/read path when a record-mode capture aborts', async () => {
    const exploding: LLMProvider = {
      name: 'boom',
      models: [],
      async *stream() {
        throw new Error('drop');
      },
      async countTokens() {
        return 0;
      },
    };
    const recorder = new RecordedProvider({ mode: 'record', upstream: exploding, fixtureDir: dir, testName: 'aborted' });
    await expect(async () => {
      for await (const _ of recorder.stream(req())) void _;
    }).rejects.toThrow(/failed mid-record/);
    // No fixture persisted → nothing tracked as written.
    expect(recorder.writtenFixtures).toEqual([]);
  });

  it('replay mode without fixture throws helpfully', async () => {
    const r = new RecordedProvider({ mode: 'replay', fixtureDir: dir, testName: 'missing' });
    await expect(async () => {
      for await (const _ of r.stream(req())) void _;
    }).rejects.toThrow(/no fixture/);
  });

  it('replay rejects a malformed (wrong-shape) fixture with a path-tagged error', async () => {
    const r = req();
    const hash = hashRequest(r);
    const file = path.join(dir, `bad.${hash}.json`);
    // Valid JSON, but no `events` array — would otherwise blow up as
    // 'events is not iterable' deep inside the generator.
    await fs.writeFile(file, JSON.stringify({ hash, request: r, recordedAt: 'x' }));
    const replayer = new RecordedProvider({ mode: 'replay', fixtureDir: dir, testName: 'bad' });
    await expect(async () => {
      for await (const _ of replayer.stream(r)) void _;
    }).rejects.toThrow(/malformed fixture/);
  });

  it('replay rejects an unparseable fixture with a path-tagged error', async () => {
    const r = req();
    const hash = hashRequest(r);
    await fs.writeFile(path.join(dir, `corrupt.${hash}.json`), '{ not valid json');
    const replayer = new RecordedProvider({ mode: 'replay', fixtureDir: dir, testName: 'corrupt' });
    await expect(async () => {
      for await (const _ of replayer.stream(r)) void _;
    }).rejects.toThrow(/unparseable fixture/);
  });

  it('record mode surfaces a mid-stream upstream failure and writes no fixture', async () => {
    const exploding: LLMProvider = {
      name: 'boom',
      models: [],
      async *stream() {
        throw new Error('network drop');
      },
      async countTokens() {
        return 0;
      },
    };
    const recorder = new RecordedProvider({
      mode: 'record',
      upstream: exploding,
      fixtureDir: dir,
      testName: 'aborted-record',
    });
    await expect(async () => {
      for await (const _ of recorder.stream(req())) void _;
    }).rejects.toThrow(/failed mid-record/);
    // A truncated capture must NOT masquerade as a complete fixture.
    expect(await fs.readdir(dir)).toHaveLength(0);
  });

  it('passthrough forwards upstream without writing', async () => {
    const upstream = new FakeProvider({ script: [textReply('direct')] });
    const r = new RecordedProvider({ mode: 'passthrough', upstream, fixtureDir: dir });
    let s = '';
    for await (const e of r.stream(req())) if (e.type === 'text_delta') s += e.delta;
    expect(s).toBe('direct');
    expect(await fs.readdir(dir)).toHaveLength(0);
  });

  it('fixtureMode reads env or defaults to replay', () => {
    expect(fixtureMode({})).toBe('replay');
    expect(fixtureMode({ MOXXY_FIXTURES: 'record' })).toBe('record');
    expect(fixtureMode({ MOXXY_FIXTURES: 'PASSTHROUGH' })).toBe('passthrough');
    expect(fixtureMode({ MOXXY_FIXTURES: 'garbage' })).toBe('replay');
  });

  it('hashRequest is stable across key order', () => {
    const a = { model: 'm', messages: [], system: 's', tools: [] };
    const b = { messages: [], system: 's', tools: [], model: 'm' };
    expect(hashRequest(a as never)).toBe(hashRequest(b as never));
  });
});
