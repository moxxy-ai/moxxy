import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  asEventId,
  asSessionId,
  asTurnId,
  type AppContext,
  type EventLogReader,
  type MoxxyEvent,
} from '@moxxy/sdk';
import { loadUsageStats } from '@moxxy/core';
import { buildUsageStatsPlugin } from './index.js';

const sid = asSessionId('s1');
const tid = asTurnId('t1');

function resp(seq: number, model: string, inputTokens: number): MoxxyEvent {
  return {
    id: asEventId(`e${seq}`),
    seq,
    ts: seq,
    sessionId: sid,
    turnId: tid,
    source: 'system',
    type: 'provider_response',
    provider: 'anthropic',
    model,
    inputTokens,
    outputTokens: 1,
  } as MoxxyEvent;
}

function reader(events: ReadonlyArray<MoxxyEvent>): EventLogReader {
  return {
    length: events.length,
    at: (seq: number) => events[seq],
    slice: (from = 0, to = events.length) => events.slice(from, to),
    ofType: ((type: string) => events.filter((e) => e.type === type)) as EventLogReader['ofType'],
    byTurn: (turnId) => events.filter((e) => e.turnId === turnId),
    toJSON: () => events,
  };
}

function ctxFor(events: ReadonlyArray<MoxxyEvent>): AppContext {
  return { sessionId: sid, cwd: '/tmp', log: reader(events), env: {} };
}

let tmpDir: string;
let statsPath: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mox-usage-plugin-'));
  statsPath = path.join(tmpDir, 'usage.json');
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe('usage-stats plugin', () => {
  it('folds the whole session for a fresh (non-resumed) run', async () => {
    const plugin = buildUsageStatsPlugin({ statsPath });
    const events = [resp(0, 'opus', 100), resp(1, 'opus', 50)];

    await plugin.hooks!.onInit!(ctxFor([])); // boots with empty log
    await plugin.hooks!.onShutdown!(ctxFor(events));

    const file = await loadUsageStats(statsPath);
    expect(file.models['anthropic/opus']!.calls).toBe(2);
    expect(file.models['anthropic/opus']!.inputTokens).toBe(150);
  });

  it('skips restored events on resume and folds only the live suffix', async () => {
    const restored = [resp(0, 'opus', 1000), resp(1, 'opus', 2000)];
    const liveSuffix = [resp(2, 'opus', 30)];
    const plugin = buildUsageStatsPlugin({ statsPath });

    // onInit fires after restored events are already seeded into the log.
    await plugin.hooks!.onInit!(ctxFor(restored));
    // onShutdown sees restored + live.
    await plugin.hooks!.onShutdown!(ctxFor([...restored, ...liveSuffix]));

    const file = await loadUsageStats(statsPath);
    // Only the single live call (30 tokens) is counted — not the 3000 restored.
    expect(file.models['anthropic/opus']!.calls).toBe(1);
    expect(file.models['anthropic/opus']!.inputTokens).toBe(30);
  });

  it('writes nothing when no live events were produced', async () => {
    const plugin = buildUsageStatsPlugin({ statsPath });
    await plugin.hooks!.onInit!(ctxFor([resp(0, 'opus', 100)]));
    await plugin.hooks!.onShutdown!(ctxFor([resp(0, 'opus', 100)]));
    // No new events past the cursor → file never created.
    expect((await loadUsageStats(statsPath)).models).toEqual({});
  });
});
