import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  asEventId,
  asSessionId,
  asSkillId,
  asTurnId,
  type AppContext,
  type EventLogReader,
  type MoxxyEvent,
} from '@moxxy/sdk';
import { loadSkillUsage, loadUsageStats } from '@moxxy/core';
import { buildUsageStatsPlugin, summarizeSkillEvents } from './index.js';

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

function skillInvoked(seq: number, name: string, ts: number): MoxxyEvent {
  return {
    id: asEventId(`e${seq}`),
    seq,
    ts,
    sessionId: sid,
    turnId: tid,
    source: 'model',
    type: 'skill_invoked',
    skillId: asSkillId(name),
    name,
    reason: 'load_skill_tool',
  } as MoxxyEvent;
}

function skillCreated(seq: number, name: string, ts: number): MoxxyEvent {
  return {
    id: asEventId(`e${seq}`),
    seq,
    ts,
    sessionId: sid,
    turnId: tid,
    source: 'model',
    type: 'skill_created',
    skillId: asSkillId(name),
    name,
    path: `/tmp/${name}.md`,
    scope: 'user',
    originatingPrompt: `make ${name}`,
  } as MoxxyEvent;
}

function reader(events: ReadonlyArray<MoxxyEvent>): EventLogReader {
  // Faithfully model the real EventLog: `length` is a COUNT of held events,
  // while `slice(from)`/`at(seq)` are SEQ-addressed (translated through the
  // log's base). On a rebased mirror the held events' seqs start above 0.
  const base = events.length > 0 ? events[0]!.seq : 0;
  return {
    length: events.length,
    at: (seq: number) => events[seq - base],
    slice: (from = base, to = base + events.length) =>
      events.slice(Math.max(0, from - base), Math.max(0, to - base)),
    ofType: ((type: string) => events.filter((e) => e.type === type)) as EventLogReader['ofType'],
    byTurn: (turnId) => events.filter((e) => e.turnId === turnId),
    toJSON: () => events,
  };
}

function ctxFor(events: ReadonlyArray<MoxxyEvent>): AppContext {
  return { sessionId: sid, cwd: '/tmp', log: reader(events), env: {} };
}

/**
 * A stateful fake that mirrors the real `EventLog`'s clear semantics: holding
 * events with a base seq, exposing `baseSeq` + `onClear`, and on `clear()`
 * emptying the events AND resetting `base` to 0 while firing clear listeners —
 * exactly the `/new` (`Session.reset()`) lifecycle that restarts the seq stream.
 */
class FakeLog {
  private events: MoxxyEvent[];
  private base: number;
  private readonly clearListeners = new Set<() => void>();
  constructor(seed: ReadonlyArray<MoxxyEvent> = []) {
    this.events = [...seed];
    this.base = seed.length > 0 ? seed[0]!.seq : 0;
  }
  get length() {
    return this.events.length;
  }
  get baseSeq() {
    return this.base;
  }
  at(seq: number) {
    return this.events[seq - this.base];
  }
  slice(from = this.base, to = this.base + this.events.length) {
    return this.events.slice(Math.max(0, from - this.base), Math.max(0, to - this.base));
  }
  ofType(type: string) {
    return this.events.filter((e) => e.type === type);
  }
  byTurn(turnId: unknown) {
    return this.events.filter((e) => e.turnId === turnId);
  }
  toJSON() {
    return this.events;
  }
  onClear(fn: () => void) {
    this.clearListeners.add(fn);
    return () => this.clearListeners.delete(fn);
  }
  /** Test-only: how many clear listeners are currently registered. Lets a test
   * assert the plugin actually tears its `onClear` subscription down on shutdown
   * (no leaked listener under a one-instance-many-sessions host). */
  get clearListenerCount() {
    return this.clearListeners.size;
  }
  /** Append more live events after `onInit` has captured the boundary. */
  push(...more: MoxxyEvent[]) {
    this.events.push(...more);
  }
  /** `/new` wipe: empty events, reset base to 0, fire clear listeners. */
  clear() {
    this.events = [];
    this.base = 0;
    for (const fn of [...this.clearListeners]) fn();
  }
}

function ctxForLog(log: FakeLog, sessionId = sid): AppContext {
  return { sessionId, cwd: '/tmp', log: log as unknown as EventLogReader, env: {} };
}

let tmpDir: string;
let statsPath: string;
let skillUsagePath: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mox-usage-plugin-'));
  statsPath = path.join(tmpDir, 'usage.json');
  skillUsagePath = path.join(tmpDir, 'skill-usage.json');
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

  it('counts only live events on a rebased mirror (baseSeq > 0), not the restored prefix', async () => {
    // A partial-replay mirror primes the log with restored events at seqs that
    // start above 0. A length-as-seq cursor would clamp to the base and re-fold
    // the entire restored prefix, double-counting. Tracking the boundary by seq
    // is base-independent.
    const restored = [resp(100, 'opus', 1000), resp(101, 'opus', 2000), resp(102, 'opus', 4000)];
    const liveSuffix = [resp(103, 'opus', 30)];
    const plugin = buildUsageStatsPlugin({ statsPath });

    await plugin.hooks!.onInit!(ctxFor(restored));
    await plugin.hooks!.onShutdown!(ctxFor([...restored, ...liveSuffix]));

    const file = await loadUsageStats(statsPath);
    // Only the single live call (30 tokens) — never the 7000 restored tokens.
    expect(file.models['anthropic/opus']!.calls).toBe(1);
    expect(file.models['anthropic/opus']!.inputTokens).toBe(30);
  });

  it('counts the post-/new (log clear/reset) suffix that restarts at seq 0', async () => {
    // Regression: `Session.reset()` (the `/new` flow) calls `log.clear()`, which
    // empties the events AND resets base to 0 — restarting the authoritative seq
    // stream WITHOUT re-firing onInit. A boundary captured at init (e.g. 102 from
    // a restored prefix) would then drop every post-/new event (seqs 0,1,2…),
    // silently losing the whole session's usage. The plugin must re-baseline on
    // clear and fold the post-wipe suffix.
    const plugin = buildUsageStatsPlugin({ statsPath });
    const log = new FakeLog([resp(100, 'opus', 1000), resp(101, 'opus', 2000)]);

    await plugin.hooks!.onInit!(ctxForLog(log)); // boundary captured at seq 101
    log.clear(); // /new — events emptied, base reset to 0, onClear fires
    log.push(resp(0, 'opus', 40), resp(1, 'opus', 60)); // post-/new live events

    await plugin.hooks!.onShutdown!(ctxForLog(log));

    const file = await loadUsageStats(statsPath);
    // Both post-/new calls counted (100 tokens) — not dropped as <= old boundary.
    expect(file.models['anthropic/opus']!.calls).toBe(2);
    expect(file.models['anthropic/opus']!.inputTokens).toBe(100);
  });

  it('isolates the cursor per session so concurrent sessions on one instance never clobber each other', async () => {
    // One shared plugin instance, two interleaved session lifecycles. A single
    // scalar cursor would let session B's onInit overwrite session A's boundary;
    // keying by sessionId keeps both correct.
    const plugin = buildUsageStatsPlugin({ statsPath });
    const sidA = asSessionId('A');
    const sidB = asSessionId('B');
    const logA = new FakeLog([resp(0, 'opus', 1000)]); // A restored 1 event (seq 0)
    const logB = new FakeLog([]); // B is a fresh run

    await plugin.hooks!.onInit!(ctxForLog(logA, sidA)); // A boundary = 0
    await plugin.hooks!.onInit!(ctxForLog(logB, sidB)); // B boundary = null (would clobber A's scalar)

    logA.push(resp(1, 'opus', 5)); // A's single live call
    logB.push(resp(0, 'opus', 7)); // B's single live call

    await plugin.hooks!.onShutdown!(ctxForLog(logA, sidA));
    await plugin.hooks!.onShutdown!(ctxForLog(logB, sidB));

    const file = await loadUsageStats(statsPath);
    // A counts only its live call (5), B counts its only call (7) → 2 calls, 12.
    expect(file.models['anthropic/opus']!.calls).toBe(2);
    expect(file.models['anthropic/opus']!.inputTokens).toBe(12);
  });

  it('folds the whole log when onShutdown fires without a preceding onInit (cursor defaults to null)', async () => {
    // Documents the deliberate null-cursor default: the "counted exactly once on
    // resume" guarantee hinges on onInit running first to capture the restored
    // prefix length. On an abnormal lifecycle (onShutdown with no onInit) the
    // cursor is absent → treated as null → the entire log is folded — accepted
    // behavior, asserted here so a future guard change is a conscious one.
    const plugin = buildUsageStatsPlugin({ statsPath });
    const events = [resp(0, 'opus', 100), resp(1, 'opus', 50)];

    await plugin.hooks!.onShutdown!(ctxFor(events)); // no onInit called

    const file = await loadUsageStats(statsPath);
    expect(file.models['anthropic/opus']!.calls).toBe(2);
    expect(file.models['anthropic/opus']!.inputTokens).toBe(150);
  });

  it('onShutdown degrades to a no-op (resolves, writes nothing) when the reader throws', async () => {
    // Worst case: a hostile/half-implemented reader whose `ofType` throws on the
    // 5s-timeboxed shutdown path. The plugin must swallow it — usage stats are an
    // optional, best-effort layer — and resolve instead of rejecting the hook
    // (which the host would log as a spurious failure). No file is written.
    const plugin = buildUsageStatsPlugin({ statsPath });
    const hostile = {
      length: 1,
      at: () => undefined,
      slice: () => [],
      ofType: () => {
        throw new Error('reader exploded');
      },
      byTurn: () => [],
      toJSON: () => [],
    } as unknown as EventLogReader;
    const ctx = { sessionId: sid, cwd: '/tmp', log: hostile, env: {} } as AppContext;

    await expect(plugin.hooks!.onShutdown!(ctx)).resolves.toBeUndefined();
    // Nothing folded → file never created.
    expect((await loadUsageStats(statsPath)).models).toEqual({});
  });

  it('onInit degrades gracefully when boundarySeq/onClear throw, still counting the run', async () => {
    // A reader that throws from `ofType` (the boundarySeq fallback) AND from
    // `onClear` at init time must not crash init. The cursor falls back to null
    // (fold-whole-suffix default), so a subsequent shutdown with a WORKING reader
    // still records the run rather than silently losing it.
    const plugin = buildUsageStatsPlugin({ statsPath });
    const throwingInit = {
      length: 3, // non-empty → boundarySeq won't early-return; no baseSeq → hits ofType
      at: () => undefined,
      slice: () => [],
      ofType: () => {
        throw new Error('ofType exploded at init');
      },
      byTurn: () => [],
      toJSON: () => [],
      onClear: () => {
        throw new Error('onClear exploded at init');
      },
    } as unknown as EventLogReader;
    const initCtx = { sessionId: sid, cwd: '/tmp', log: throwingInit, env: {} } as AppContext;

    // onInit is synchronous; it must not throw despite ofType + onClear both
    // throwing. (`Promise.resolve` tolerates the sync void return.)
    expect(() => plugin.hooks!.onInit!(initCtx)).not.toThrow();

    // Now shut down with a healthy reader: null cursor folds the whole log.
    await plugin.hooks!.onShutdown!(ctxFor([resp(0, 'opus', 10), resp(1, 'opus', 20)]));

    const file = await loadUsageStats(statsPath);
    expect(file.models['anthropic/opus']!.calls).toBe(2);
    expect(file.models['anthropic/opus']!.inputTokens).toBe(30);
  });

  it('onShutdown tears down the onClear listener even when the fold/merge path throws (no leak)', async () => {
    // The unsubscribe + map deletes must run before (and regardless of) the
    // fold/merge, so a throwing reader can't strand the onClear listener or leave
    // the cursor map growing unbounded under a one-instance-many-sessions host.
    const plugin = buildUsageStatsPlugin({ statsPath });
    let unsubscribed = false;
    let throwFromOfType = false;
    const log = {
      length: 0,
      at: () => undefined,
      slice: () => [],
      ofType: () => {
        if (throwFromOfType) throw new Error('shutdown reader exploded');
        return [];
      },
      byTurn: () => [],
      toJSON: () => [],
      onClear: () => () => {
        unsubscribed = true;
      },
    } as unknown as EventLogReader;
    const ctx = { sessionId: sid, cwd: '/tmp', log, env: {} } as AppContext;

    await plugin.hooks!.onInit!(ctx); // registers the clear listener (ofType ok: empty log path)
    throwFromOfType = true; // now the fold path will throw on shutdown
    await expect(plugin.hooks!.onShutdown!(ctx)).resolves.toBeUndefined();
    // Listener was unsubscribed despite the fold throwing → no leak.
    expect(unsubscribed).toBe(true);
  });

  it('degrades to a no-op when the reader returns a non-array from ofType (not just when it throws)', async () => {
    // Worst case beyond a throwing reader: a half-implemented/hostile reader
    // whose `ofType` returns garbage (a number, null) instead of an array. The
    // plugin does `responses.filter(...)`, which raises a TypeError on a
    // non-array — it must be swallowed by the same best-effort guard, resolving
    // the hook and writing nothing rather than crashing the timeboxed shutdown.
    const plugin = buildUsageStatsPlugin({ statsPath });
    for (const bogus of [42, null, 'nope', { length: 1 }] as unknown[]) {
      const garbageReader = {
        length: 1,
        at: () => undefined,
        slice: () => [],
        ofType: () => bogus,
        byTurn: () => [],
        toJSON: () => [],
      } as unknown as EventLogReader;
      const ctx = { sessionId: sid, cwd: '/tmp', log: garbageReader, env: {} } as AppContext;
      await expect(plugin.hooks!.onShutdown!(ctx)).resolves.toBeUndefined();
    }
    // No call ever produced a fold-able array → file never created.
    expect((await loadUsageStats(statsPath)).models).toEqual({});
  });

  it('onShutdown for a session that never ran onInit folds the whole log and leaves no leaked state', async () => {
    // Abnormal lifecycle on a SHARED instance: onShutdown arrives for a session
    // id the plugin never saw onInit for (absent cursor → treated as null →
    // whole-log fold). It must not throw on the map.delete of an absent key, and
    // a SECOND shutdown for the same id must behave identically (idempotent,
    // never resurrecting a stale cursor) — proving the map self-cleans even on
    // the no-onInit path so it can't grow unbounded under a many-sessions host.
    const plugin = buildUsageStatsPlugin({ statsPath });
    const events = [resp(0, 'opus', 100)];

    await expect(plugin.hooks!.onShutdown!(ctxFor(events))).resolves.toBeUndefined();
    // A repeat shutdown re-folds the same whole log (cursor still absent → null),
    // so it must not throw; the aggregate doubles, which is the documented
    // whole-log-fold default, asserted so a future guard change is deliberate.
    await expect(plugin.hooks!.onShutdown!(ctxFor(events))).resolves.toBeUndefined();

    const file = await loadUsageStats(statsPath);
    expect(file.models['anthropic/opus']!.calls).toBe(2);
    expect(file.models['anthropic/opus']!.inputTokens).toBe(200);
  });

  it('a re-init of the same session id replaces (does not stack) the onClear listener', async () => {
    // Worst case under a host that re-dispatches onInit for the same session id
    // without an intervening onShutdown (e.g. a buggy/abnormal lifecycle, or a
    // resume that re-inits). Each init must REPLACE the prior onClear listener,
    // not add a second one — otherwise listeners would accumulate (a leak) and a
    // single clear() would fire stale closures. We assert the real FakeLog only
    // ever holds one listener across repeated inits, and exactly zero after
    // shutdown.
    const plugin = buildUsageStatsPlugin({ statsPath });
    const log = new FakeLog([resp(0, 'opus', 10)]);

    await plugin.hooks!.onInit!(ctxForLog(log));
    await plugin.hooks!.onInit!(ctxForLog(log));
    await plugin.hooks!.onInit!(ctxForLog(log));
    expect(log.clearListenerCount).toBe(1); // replaced each time, never stacked

    await plugin.hooks!.onShutdown!(ctxForLog(log));
    expect(log.clearListenerCount).toBe(0); // fully torn down
  });

  it('preserves a valid resume boundary when onClear registration throws (no double-count)', async () => {
    // Regression: `boundarySeq` succeeds (a clean restored prefix, seqs 100..102)
    // but the reader's `onClear` registration throws. The boundary is the
    // load-bearing correctness value — it must SURVIVE the onClear failure.
    // Discarding it (resetting the cursor to null) would re-fold the entire
    // restored prefix on shutdown and DOUBLE-COUNT 7000 restored tokens into the
    // lifetime aggregate. Only the single live call (30) may be counted.
    const plugin = buildUsageStatsPlugin({ statsPath });
    const restored = [resp(100, 'opus', 1000), resp(101, 'opus', 2000), resp(102, 'opus', 4000)];
    const onClearThrows = {
      length: restored.length,
      baseSeq: 100, // boundarySeq takes the O(1) path → 100 + 3 - 1 = 102
      at: () => undefined,
      slice: () => [],
      ofType: ((type: string) =>
        type === 'provider_response' ? restored : []) as EventLogReader['ofType'],
      byTurn: () => [],
      toJSON: () => restored,
      onClear: () => {
        throw new Error('onClear registration exploded');
      },
    } as unknown as EventLogReader;
    const initCtx = { sessionId: sid, cwd: '/tmp', log: onClearThrows, env: {} } as AppContext;

    expect(() => plugin.hooks!.onInit!(initCtx)).not.toThrow();
    // Shut down with restored prefix + one live call. The preserved boundary (102)
    // must exclude every restored response and include only the live one.
    await plugin.hooks!.onShutdown!(ctxFor([...restored, resp(103, 'opus', 30)]));

    const file = await loadUsageStats(statsPath);
    expect(file.models['anthropic/opus']!.calls).toBe(1);
    expect(file.models['anthropic/opus']!.inputTokens).toBe(30); // not 7030
  });

  it('actually tears down the real onClear listener on shutdown (no leaked subscription)', async () => {
    // The prior "no leak" test used a hand-rolled fake whose unsubscribe just
    // flipped a flag; it could not prove the real subscription was removed. Here
    // the stateful FakeLog tracks live listeners, so we assert the count returns
    // to zero after shutdown — and that a post-shutdown clear() can't resurrect a
    // cursor entry by firing a stale listener.
    const plugin = buildUsageStatsPlugin({ statsPath });
    const log = new FakeLog([resp(0, 'opus', 100)]);

    await plugin.hooks!.onInit!(ctxForLog(log));
    expect(log.clearListenerCount).toBe(1); // listener registered

    log.push(resp(1, 'opus', 50));
    await plugin.hooks!.onShutdown!(ctxForLog(log));
    expect(log.clearListenerCount).toBe(0); // torn down — no leak

    // A clear() now fires no plugin listener; a second shutdown sees an absent
    // cursor (null) and folds the (post-clear, empty) log → still no crash.
    log.clear();
    await expect(plugin.hooks!.onShutdown!(ctxForLog(log))).resolves.toBeUndefined();

    const file = await loadUsageStats(statsPath);
    // Only the first run's live call (50) — the restored 100 was excluded, and
    // the post-shutdown clear added nothing.
    expect(file.models['anthropic/opus']!.calls).toBe(1);
    expect(file.models['anthropic/opus']!.inputTokens).toBe(50);
  });
});

describe('summarizeSkillEvents', () => {
  it('counts invocations per name and keeps the latest invocation timestamp', () => {
    const delta = summarizeSkillEvents(
      [skillInvoked(0, 'deploy', 1000), skillInvoked(1, 'deploy', 3000), skillInvoked(2, 'lint', 2000)],
      [],
    );
    expect(delta['deploy']!.invocations).toBe(2);
    expect(delta['deploy']!.lastInvokedAt).toBe(new Date(3000).toISOString());
    expect(delta['lint']!.invocations).toBe(1);
  });

  it('records createdAt for a created-but-never-invoked skill (invocations 0)', () => {
    const delta = summarizeSkillEvents([], [skillCreated(0, 'fresh', 5000)]);
    expect(delta['fresh']!.invocations).toBe(0);
    expect(delta['fresh']!.createdAt).toBe(new Date(5000).toISOString());
  });

  it('is empty for no events', () => {
    expect(summarizeSkillEvents([], [])).toEqual({});
  });
});

describe('usage-stats plugin — skill folding', () => {
  it('folds skill_invoked/skill_created into the skill usage store on shutdown', async () => {
    const plugin = buildUsageStatsPlugin({ statsPath, skillUsagePath });
    const events = [
      skillCreated(0, 'deploy', 1000),
      skillInvoked(1, 'deploy', 2000),
      skillInvoked(2, 'deploy', 4000),
      skillInvoked(3, 'lint', 3000),
    ];

    await plugin.hooks!.onInit!(ctxFor([]));
    await plugin.hooks!.onShutdown!(ctxFor(events));

    const file = await loadSkillUsage(skillUsagePath);
    expect(file.skills['deploy']!.invocations).toBe(2);
    expect(file.skills['deploy']!.createdAt).toBe(new Date(1000).toISOString());
    expect(file.skills['deploy']!.lastInvokedAt).toBe(new Date(4000).toISOString());
    expect(file.skills['lint']!.invocations).toBe(1);
  });

  it('counts only the live skill suffix on resume (skips restored skill events)', async () => {
    const restored = [skillInvoked(0, 'deploy', 1000), skillInvoked(1, 'deploy', 2000)];
    const live = [skillInvoked(2, 'deploy', 3000)];
    const plugin = buildUsageStatsPlugin({ statsPath, skillUsagePath });

    await plugin.hooks!.onInit!(ctxFor(restored));
    await plugin.hooks!.onShutdown!(ctxFor([...restored, ...live]));

    // Only the single live invocation is counted — not the 2 restored.
    expect((await loadSkillUsage(skillUsagePath)).skills['deploy']!.invocations).toBe(1);
  });

  it('folds skill usage even when the run produced no provider_response (no token early-return)', async () => {
    // Regression: the token fold used to `return` early when no responses were
    // present, which would skip the skill fold entirely. They must be independent.
    const plugin = buildUsageStatsPlugin({ statsPath, skillUsagePath });
    const events = [skillInvoked(0, 'deploy', 1000)];

    await plugin.hooks!.onInit!(ctxFor([]));
    await plugin.hooks!.onShutdown!(ctxFor(events));

    expect((await loadSkillUsage(skillUsagePath)).skills['deploy']!.invocations).toBe(1);
    // No token usage was recorded (no provider_response events).
    expect((await loadUsageStats(statsPath)).models).toEqual({});
  });

  it('writes no skill usage file when the run exercised no skills', async () => {
    const plugin = buildUsageStatsPlugin({ statsPath, skillUsagePath });
    await plugin.hooks!.onInit!(ctxFor([]));
    await plugin.hooks!.onShutdown!(ctxFor([resp(0, 'opus', 100)]));
    // Empty skill delta → merge never touches disk.
    await expect(fs.access(skillUsagePath)).rejects.toThrow();
  });
});
