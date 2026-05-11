import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
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

  it('replay mode without fixture throws helpfully', async () => {
    const r = new RecordedProvider({ mode: 'replay', fixtureDir: dir, testName: 'missing' });
    await expect(async () => {
      for await (const _ of r.stream(req())) void _;
    }).rejects.toThrow(/no fixture/);
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
