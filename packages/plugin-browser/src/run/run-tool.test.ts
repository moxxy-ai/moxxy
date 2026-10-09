import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RunMemory, type AskJev } from '@moxxy/jev';
import type { ProviderRequest, ToolContext, ToolDef } from '@moxxy/sdk';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { JevAccess, RUN_TOOL, buildRunTool, withBrowserRunGuidance } from './run-tool.js';

/** The desktop's bridge, as the tool reaches it: one recorded call per method. */
function bridge() {
  const calls: Array<{ method: string; params: Record<string, unknown> }> = [];
  let page = 'home';
  const call = async (method: string, params: Record<string, unknown>) => {
    calls.push({ method, params });
    if (method === 'tree') {
      return {
        tabId: 't1',
        url: `https://books.toscrape.com/${page}`,
        title: page,
        page: page === 'home' ? 'link "Travel"' : 'heading "Travel"',
        tree: {
          app: 'books.toscrape.com',
          window: page,
          elements: page === 'home' ? [{ key: '/link[1]', index: 3, depth: 1, role: 'link', title: 'Travel' }] : [],
        },
      };
    }
    if (method === 'act') {
      page = 'travel';
      return { tabId: 't1', navigated: true };
    }
    if (method === 'snapshot') return { text: '### Page\n- URL: https://books.toscrape.com/travel', tabId: 't1', url: 'x' };
    return {};
  };
  return { call, calls };
}

const ctx = (secrets: Record<string, string> = {}, sessionId = 's1'): ToolContext =>
  ({
    sessionId,
    turnId: 't',
    callId: 'c',
    cwd: '/tmp',
    signal: new AbortController().signal,
    log: { ofType: () => [] },
    logger: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
    getSecret: async (name: string) => secrets[name] ?? null,
  }) as unknown as ToolContext;

const noJev: AskJev = async () => {
  throw new Error('Jev was asked');
};

function tool(access = new JevAccess(), b = bridge(), jev: (key: string) => AskJev = () => noJev): { run: ToolDef; b: ReturnType<typeof bridge>; keys: string[] } {
  const keys: string[] = [];
  const run = buildRunTool(b.call, {
    access,
    jev: (key) => {
      keys.push(key);
      return jev(key);
    },
    memory: new RunMemory(mkdtempSync(join(tmpdir(), 'run-tool-')), () => 1),
  });
  return { run, b, keys };
}

beforeEach(() => vi.stubEnv('TYPESAFE_API_KEY', ''));
afterEach(() => vi.unstubAllEnvs());

describe('browser_run', () => {
  it('runs the steps through the bridge with the key from the vault, and reads the page once at the end', async () => {
    const { run, b, keys } = tool();

    const out = (await run.handler(
      run.inputSchema.parse({ goal: 'open Travel', steps: [{ do: 'click', target: 'Travel' }] }),
      ctx({ TYPESAFE_API_KEY: 'k-1' }),
    )) as { text: string };

    expect(keys).toEqual(['k-1']);
    expect(b.calls.map((c) => c.method)).toEqual(['tree', 'act', 'tree', 'snapshot']);
    expect(b.calls[1]?.params).toMatchObject({ action: 'click', uid: '3', tab_id: 't1' });
    // The report already says what each step did, so the page after it is the
    // short read: in the Coolify task every run ended with 10–15k characters.
    expect(b.calls[3]?.params).toMatchObject({ tab_id: 't1', brief: true });
    expect(out.text).toMatch(/1 of 1 steps done/);
    expect(out.text).toContain('### Page');
  });

  it('is acted on under the site consent, not a prompt per run', () => {
    expect(tool().run.permission?.action).toBe('allow');
  });

  it('refuses before touching the page when there is no key, or Jev is switched off', async () => {
    for (const secrets of [{}, { TYPESAFE_API_KEY: 'k-1', JEV_DISABLED: '1' }]) {
      const { run, b } = tool();
      await expect(run.handler(run.inputSchema.parse({ goal: 'g', steps: [{ do: 'key', key: 'Escape' }] }), ctx(secrets))).rejects.toThrow(/TypeSafe/);
      expect(b.calls).toEqual([]);
    }
  });

  it('refuses a step that lacks what it needs, before anything runs', async () => {
    const { run, b } = tool();
    await expect(run.handler(run.inputSchema.parse({ goal: 'g', steps: [{ do: 'click' }] }), ctx({ TYPESAFE_API_KEY: 'k' }))).rejects.toThrow(
      /step 1: a click step needs a target/,
    );
    expect(b.calls).toEqual([]);
  });
});

describe('withBrowserRunGuidance', () => {
  const request = (names: string[]): ProviderRequest =>
    ({ system: 'base', messages: [], tools: names.map((name) => ({ name, description: '', inputSchema: {} })) }) as unknown as ProviderRequest;

  it('takes browser_run out of a session that has no key, and says nothing of it', () => {
    const hook = withBrowserRunGuidance(new JevAccess());
    const out = hook(request(['browser_snapshot', RUN_TOOL]), { sessionId: 's1' });

    expect(out.tools?.map((t) => t.name)).toEqual(['browser_snapshot']);
    expect(out.system).toBe('base');
  });

  it('keeps it and says when to use it once a tool call found a key', async () => {
    const access = new JevAccess();
    await access.key(ctx({ TYPESAFE_API_KEY: 'k' }));
    const hook = withBrowserRunGuidance(access);

    const once = hook(request(['browser_snapshot', RUN_TOOL]), { sessionId: 's1' });
    const twice = hook(once, { sessionId: 's1' });

    expect(once.tools?.map((t) => t.name)).toContain(RUN_TOOL);
    expect(once.system).toContain(RUN_TOOL);
    expect(twice.system).toBe(once.system);
    expect(hook(request(['browser_snapshot', RUN_TOOL]), { sessionId: 'other' }).tools?.map((t) => t.name)).not.toContain(RUN_TOOL);
  });

  it('makes a run the default way to act, not one tool among many', async () => {
    const access = new JevAccess();
    await access.key(ctx({ TYPESAFE_API_KEY: 'k' }));
    const system = withBrowserRunGuidance(access)(request(['browser_click', RUN_TOOL]), { sessionId: 's1' }).system ?? '';

    expect(system).toMatch(/even a single (click|step)/);
    expect(system).toMatch(/instead of browser_click, browser_type, browser_select and browser_batch/);
    expect(system).toMatch(/without reading the page first/);
  });

  it('says a run cannot open an address, so a named address is opened first and a tab left from earlier work is not it', async () => {
    const access = new JevAccess();
    await access.key(ctx({ TYPESAFE_API_KEY: 'k' }));
    const system = withBrowserRunGuidance(access)(request(['browser_navigate', RUN_TOOL]), { sessionId: 's1' }).system ?? '';

    expect(system).toMatch(/works on the page that is already open and cannot open an address/);
    expect(system).toMatch(/When the user names an address, open it with browser_navigate before anything else/);
    expect(system).toMatch(/a tab left open from earlier work is not that page/);
  });

  it('trusts the environment before any tool call has looked into the vault', () => {
    vi.stubEnv('TYPESAFE_API_KEY', 'k');
    const out = withBrowserRunGuidance(new JevAccess())(request([RUN_TOOL]), { sessionId: 's1' });
    expect(out.tools?.map((t) => t.name)).toEqual([RUN_TOOL]);
  });

  it('leaves a request without browser tools alone', () => {
    const plain = request(['Read']);
    expect(withBrowserRunGuidance(new JevAccess())(plain, { sessionId: 's1' })).toBe(plain);
  });
});
