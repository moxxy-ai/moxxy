import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { asSessionId, asTurnId, type ToolContext, type ToolDef } from '@moxxy/sdk';
import { buildSelfUpdatePlugin, type SelfUpdateDeps, type SkipInfo } from './index.js';
import { readJournal } from './transaction.js';

const tempDirs: string[] = [];
afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((d) => fs.rm(d, { recursive: true, force: true })));
});

/**
 * In-memory stand-in for the plugin host: a reload rescans the on-disk plugin
 * dirs and registers a `<name>_tool` for each loadable entry, or records a skip
 * for one whose entry contains the marker `BROKEN`.
 */
class FakeHost {
  tools = new Set<string>();
  skips: SkipInfo[] = [];
  reloads = 0;
  constructor(readonly moxxyDir: string) {}

  reload = async (): Promise<void> => {
    this.reloads++;
    this.tools = new Set();
    this.skips = [];
    const pluginsDir = path.join(this.moxxyDir, 'plugins');
    const names = await fs.readdir(pluginsDir).catch(() => [] as string[]);
    for (const name of names) {
      const content = await fs
        .readFile(path.join(pluginsDir, name, 'index.mjs'), 'utf8')
        .catch(() => null);
      if (content == null) continue;
      if (content.includes('BROKEN')) this.skips.push({ pluginName: name, message: 'SyntaxError: broken entry' });
      else this.tools.add(`${name}_tool`);
    }
  };

  unload = async (name: string): Promise<void> => {
    this.tools.delete(`${name}_tool`);
    this.skips = this.skips.filter((s) => s.pluginName !== name);
  };

  deps(): SelfUpdateDeps {
    return {
      moxxyDir: this.moxxyDir,
      reload: this.reload,
      unload: this.unload,
      snapshot: () => ({
        tools: [...this.tools],
        agents: [],
        providers: [],
        modes: [],
        compactors: [],
        channels: [],
      }),
      skipped: () => this.skips,
      emit: async () => undefined,
    };
  }
}

function makeCtx(): ToolContext {
  return {
    sessionId: asSessionId('s'),
    turnId: asTurnId('t'),
    callId: 't:0' as never,
    cwd: '/tmp',
    signal: new AbortController().signal,
    log: { length: 0, at: () => undefined, slice: () => [], ofType: () => [], byTurn: () => [], toJSON: () => [] },
    logger: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
  } as unknown as ToolContext;
}

async function makeMoxxyDir(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'moxxy-su-int-'));
  tempDirs.push(dir);
  await fs.mkdir(path.join(dir, 'plugins'), { recursive: true });
  return dir;
}

function tools(deps: SelfUpdateDeps): Record<string, ToolDef> {
  const plugin = buildSelfUpdatePlugin(deps);
  const out: Record<string, ToolDef> = {};
  for (const t of plugin.tools ?? []) out[t.name] = t;
  return out;
}

async function writePlugin(moxxy: string, name: string, content: string): Promise<void> {
  const dir = path.join(moxxy, 'plugins', name);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, 'index.mjs'), content, 'utf8');
}

describe('self-update happy path', () => {
  it('begins, verifies a new plugin, and applies', async () => {
    const moxxy = await makeMoxxyDir();
    const host = new FakeHost(moxxy);
    const t = tools(host.deps());
    const ctx = makeCtx();

    const begun = (await t.self_update_begin!.handler({ kind: 'plugin', name: 'greeter' }, ctx)) as {
      txnId: string;
      existedBefore: boolean;
    };
    expect(begun.existedBefore).toBe(false);

    await writePlugin(moxxy, 'greeter', 'export default { name: "greeter" };\n');

    const verified = (await t.self_update_verify!.handler({ txnId: begun.txnId }, ctx)) as {
      ok: boolean;
      registered: Record<string, string[]>;
    };
    expect(verified.ok).toBe(true);
    expect(verified.registered.tools).toEqual(['greeter_tool']);

    await t.self_update_apply!.handler({ txnId: begun.txnId }, ctx);
    expect((await readJournal(moxxy, begun.txnId)).state).toBe('committed');
  });
});

describe('failed build / load auto-rollback + escalation', () => {
  it('fails a broken new plugin, leaves files for retry, escalates after 2 cycles', async () => {
    const moxxy = await makeMoxxyDir();
    const host = new FakeHost(moxxy);
    const t = tools(host.deps());
    const ctx = makeCtx();

    const begun = (await t.self_update_begin!.handler({ kind: 'plugin', name: 'oops' }, ctx)) as {
      txnId: string;
    };
    await writePlugin(moxxy, 'oops', 'BROKEN syntax (((\n');

    const first = (await t.self_update_verify!.handler({ txnId: begun.txnId }, ctx)) as {
      ok: boolean;
      escalate: boolean;
    };
    expect(first.ok).toBe(false);
    expect(first.escalate).toBe(false);
    // New artifact is left in place so the model can fix it and retry.
    await expect(fs.access(path.join(moxxy, 'plugins', 'oops'))).resolves.toBeUndefined();

    const second = (await t.self_update_verify!.handler({ txnId: begun.txnId }, ctx)) as { ok: boolean };
    expect(second.ok).toBe(false);

    // Third call hits the cap → escalate + clean up.
    const third = (await t.self_update_verify!.handler({ txnId: begun.txnId }, ctx)) as {
      ok: boolean;
      escalate: boolean;
    };
    expect(third.escalate).toBe(true);
    expect((await readJournal(moxxy, begun.txnId)).state).toBe('escalated');
    await expect(fs.access(path.join(moxxy, 'plugins', 'oops'))).rejects.toBeTruthy();
  });

  it('restores the previous working version when a MODIFY fails to load', async () => {
    const moxxy = await makeMoxxyDir();
    const host = new FakeHost(moxxy);
    const t = tools(host.deps());
    const ctx = makeCtx();

    const good = 'export default { name: "bar" };\n';
    await writePlugin(moxxy, 'bar', good);

    const begun = (await t.self_update_begin!.handler({ kind: 'plugin', name: 'bar' }, ctx)) as {
      txnId: string;
      existedBefore: boolean;
    };
    expect(begun.existedBefore).toBe(true);

    await writePlugin(moxxy, 'bar', 'BROKEN now\n');
    const res = (await t.self_update_verify!.handler({ txnId: begun.txnId }, ctx)) as {
      ok: boolean;
      recovered: boolean;
    };
    expect(res.ok).toBe(false);
    expect(res.recovered).toBe(true);
    // Previous working entry is back, and it's loadable again.
    expect(await fs.readFile(path.join(moxxy, 'plugins', 'bar', 'index.mjs'), 'utf8')).toBe(good);
    expect(host.tools.has('bar_tool')).toBe(true);
  });
});

describe('rollback', () => {
  it('deletes a committed new plugin and reloads', async () => {
    const moxxy = await makeMoxxyDir();
    const host = new FakeHost(moxxy);
    const t = tools(host.deps());
    const ctx = makeCtx();

    const begun = (await t.self_update_begin!.handler({ kind: 'plugin', name: 'temp' }, ctx)) as {
      txnId: string;
    };
    await writePlugin(moxxy, 'temp', 'export default { name: "temp" };\n');
    await t.self_update_verify!.handler({ txnId: begun.txnId }, ctx);
    expect(host.tools.has('temp_tool')).toBe(true);

    await t.self_update_rollback!.handler({ txnId: begun.txnId, reason: 'not needed' }, ctx);
    await expect(fs.access(path.join(moxxy, 'plugins', 'temp'))).rejects.toBeTruthy();
    expect(host.tools.has('temp_tool')).toBe(false);
    expect((await readJournal(moxxy, begun.txnId)).state).toBe('rolled_back');
  });
});
