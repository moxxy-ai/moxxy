import { afterEach, describe, expect, it } from 'vitest';
import { PassThrough } from 'node:stream';
import { buildAgentTools } from './agent-tools.js';
import { closeBrowserSidecar, type SidecarStream } from './browser-session.js';
import { zodToJsonSchema } from '@moxxy/sdk';
import type { ToolContext, ToolDef } from '@moxxy/sdk';

/**
 * The tools the model calls. Driven against a fake sidecar over the real
 * newline-JSON transport, so the wiring under test is the wiring that ships.
 */

interface Fake {
  spawn: (path: string) => SidecarStream;
  received: Array<{ method: string; params: Record<string, unknown> }>;
  setReply: (fn: (method: string) => unknown) => void;
}

function fakeSidecar(): Fake {
  const received: Array<{ method: string; params: Record<string, unknown> }> = [];
  let reply: (method: string) => unknown = () => ({});
  const spawn = (): SidecarStream => {
    const stdin = new PassThrough();
    const stdout = new PassThrough();
    let buf = '';
    stdin.on('data', (chunk) => {
      buf += chunk.toString('utf8');
      let nl: number;
      while ((nl = buf.indexOf('\n')) !== -1) {
        const line = buf.slice(0, nl);
        buf = buf.slice(nl + 1);
        if (!line.trim()) continue;
        const req = JSON.parse(line) as { id: string; method: string; params: Record<string, unknown> };
        received.push({ method: req.method, params: req.params ?? {} });
        stdout.write(JSON.stringify({ id: req.id, ok: true, result: reply(req.method) }) + '\n');
      }
    });
    const exits: Array<(c: number | null) => void> = [];
    return {
      stdin,
      stdout,
      kill: () => {
        for (const l of exits) l(0);
        return true;
      },
      once: (_e, l) => {
        exits.push(l as (c: number | null) => void);
      },
    };
  };
  return { spawn, received, setReply: (fn) => (reply = fn) };
}

function ctx(): ToolContext {
  return {
    sessionId: 's' as never,
    turnId: 't' as never,
    callId: 'c' as never,
    cwd: '/tmp',
    signal: new AbortController().signal,
    log: { length: 0, at: () => undefined, slice: () => [], ofType: () => [], byTurn: () => [], toJSON: () => [] },
    logger: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
  };
}

function byName(tools: ReadonlyArray<ToolDef>, name: string): ToolDef {
  const tool = tools.find((t) => t.name === name);
  if (!tool) throw new Error(`no tool ${name}`);
  return tool;
}

afterEach(async () => {
  await closeBrowserSidecar();
});

describe('browser_snapshot', () => {
  it('returns the page text the sidecar produced', async () => {
    const fake = fakeSidecar();
    fake.setReply(() => ({ text: '### Page\n[1] button: "OK"', tabId: 't1', url: 'https://a.pl', nodes: 2 }));
    const tools = buildAgentTools({ sidecarPath: '/fake.js', spawnFn: fake.spawn });

    const out = (await byName(tools, 'browser_snapshot').handler({}, ctx())) as { text: string };

    expect(out.text).toContain('button');
    expect(fake.received[0]?.method).toBe('snapshot');
  });

  it('forwards an explicit tab_id', async () => {
    const fake = fakeSidecar();
    fake.setReply(() => ({ text: '', tabId: 't2', url: '', nodes: 0 }));
    const tools = buildAgentTools({ sidecarPath: '/fake.js', spawnFn: fake.spawn });

    await byName(tools, 'browser_snapshot').handler({ tab_id: 't2' }, ctx());

    expect(fake.received[0]?.params.tab_id).toBe('t2');
  });

  it('is read-only, so it does not need an approval prompt', () => {
    const tools = buildAgentTools({ sidecarPath: '/fake.js', spawnFn: fakeSidecar().spawn });
    expect(byName(tools, 'browser_snapshot').permission?.action).toBe('allow');
  });
});

describe('browser_click', () => {
  it('sends the uid as a click action', async () => {
    const fake = fakeSidecar();
    fake.setReply(() => ({ tabId: 't1', url: 'https://a.pl' }));
    const tools = buildAgentTools({ sidecarPath: '/fake.js', spawnFn: fake.spawn });

    await byName(tools, 'browser_click').handler({ uid: '12', element: 'Przycisk Zaloguj' }, ctx());

    expect(fake.received[0]).toMatchObject({ method: 'act', params: { action: 'click', uid: '12' } });
  });

  it('requires a human-readable element description so an approval prompt can name it', () => {
    const tools = buildAgentTools({ sidecarPath: '/fake.js', spawnFn: fakeSidecar().spawn });
    const schema = byName(tools, 'browser_click').inputSchema;

    expect(schema.safeParse({ uid: '1' }).success).toBe(false);
    expect(schema.safeParse({ uid: '1', element: 'Przycisk Kup' }).success).toBe(true);
  });
});

describe('browser_type', () => {
  it('sends uid and text', async () => {
    const fake = fakeSidecar();
    fake.setReply(() => ({ tabId: 't1', url: '' }));
    const tools = buildAgentTools({ sidecarPath: '/fake.js', spawnFn: fake.spawn });

    await byName(tools, 'browser_type').handler({ uid: '5', element: 'Pole e-mail', text: 'a@b.pl' }, ctx());

    expect(fake.received[0]).toMatchObject({ method: 'act', params: { action: 'type', uid: '5', text: 'a@b.pl' } });
  });
});

describe('browser_navigate', () => {
  it('refuses a private address before the sidecar is touched', async () => {
    const fake = fakeSidecar();
    const tools = buildAgentTools({ sidecarPath: '/fake.js', spawnFn: fake.spawn });

    await expect(
      byName(tools, 'browser_navigate').handler({ url: 'http://169.254.169.254/latest/meta-data/' }, ctx()),
    ).rejects.toThrow();
    expect(fake.received).toHaveLength(0);
  });

  it('rejects a non-http scheme at the schema', () => {
    const tools = buildAgentTools({ sidecarPath: '/fake.js', spawnFn: fakeSidecar().spawn });
    const schema = byName(tools, 'browser_navigate').inputSchema;

    expect(schema.safeParse({ url: 'file:///etc/passwd' }).success).toBe(false);
    expect(schema.safeParse({ url: 'https://example.com' }).success).toBe(true);
  });
});

describe('browser_tabs', () => {
  it('lists tabs', async () => {
    const fake = fakeSidecar();
    fake.setReply(() => ({ tabs: [{ tabId: 't1', url: 'https://a.pl', title: 'A', active: true }], activeTabId: 't1' }));
    const tools = buildAgentTools({ sidecarPath: '/fake.js', spawnFn: fake.spawn });

    const out = (await byName(tools, 'browser_tabs').handler({ action: 'list' }, ctx())) as { activeTabId: string };

    expect(out.activeTabId).toBe('t1');
    expect(fake.received[0]?.method).toBe('tabs');
  });

  it('only accepts the four known actions', () => {
    const tools = buildAgentTools({ sidecarPath: '/fake.js', spawnFn: fakeSidecar().spawn });
    const schema = byName(tools, 'browser_tabs').inputSchema;

    for (const action of ['list', 'new', 'select', 'close']) {
      expect(schema.safeParse({ action }).success).toBe(true);
    }
    expect(schema.safeParse({ action: 'nuke' }).success).toBe(false);
  });
});

describe('the tool set', () => {
  it('declares every tool it ships', () => {
    const names = buildAgentTools({ sidecarPath: '/fake.js', spawnFn: fakeSidecar().spawn }).map((t) => t.name);

    expect(names).toEqual([
      'browser_snapshot',
      'browser_click',
      'browser_type',
      'browser_navigate',
      'browser_tabs',
      'browser_capture',
      'browser_history',
      'browser_await_human',
    ]);
  });

  it('tells the user what to do, and never asks them for the secret itself', () => {
    const tools = buildAgentTools({ sidecarPath: '/fake.js', spawnFn: fakeSidecar().spawn });
    const handoff = byName(tools, 'browser_await_human');

    // The reason is what the pane shows, so it cannot be optional.
    expect(handoff.inputSchema.safeParse({}).success).toBe(false);
    expect(handoff.inputSchema.safeParse({ reason: 'Zaloguj się w Canvie' }).success).toBe(true);
    // The description must forbid the failure mode that matters: asking the
    // user to type a password into the chat.
    expect(handoff.description).toMatch(/never ask the user to tell you a password/i);
  });

  it('gates every acting tool behind a prompt', () => {
    const tools = buildAgentTools({ sidecarPath: '/fake.js', spawnFn: fakeSidecar().spawn });

    for (const name of ['browser_click', 'browser_type', 'browser_navigate']) {
      expect(byName(tools, name).permission?.action).toBe('prompt');
    }
  });
});

describe('optional fields the model leaves empty', () => {
  /**
   * Observed live: openai-codex called browser_tabs with
   * `{action:"list", tab_id:"", url:""}` and the call was refused with
   * "url: Invalid url" before it ever reached the browser — after which the
   * model went looking for some other browser to use. Filling every declared
   * field with "" is ordinary model behaviour; on an optional field it means
   * "not set", and the schema has to read it that way.
   */
  const tools = (): ReadonlyArray<ToolDef> =>
    buildAgentTools({ sidecarPath: '/fake.js', spawnFn: fakeSidecar().spawn });

  it('reads an empty url on browser_tabs as absent', () => {
    const parsed = byName(tools(), 'browser_tabs').inputSchema.parse({ action: 'list', tab_id: '', url: '' });

    expect(parsed).toEqual({ action: 'list' });
  });

  it('reads an empty tab_id as "the active tab"', () => {
    const parsed = byName(tools(), 'browser_snapshot').inputSchema.parse({ tab_id: '' });

    expect(parsed).toEqual({});
  });

  it('reads an empty uid on browser_capture as "no crop"', () => {
    const parsed = byName(tools(), 'browser_capture').inputSchema.parse({ uid: '', tab_id: '' });

    expect(parsed).toEqual({});
  });

  it('still refuses a url that was set and is not one', () => {
    expect(() => byName(tools(), 'browser_tabs').inputSchema.parse({ action: 'new', url: 'nie-jest-urlem' })).toThrow();
  });
});

describe('the schema the model is shown', () => {
  /**
   * `blankAsAbsent` wraps a field in ZodEffects, and a provider that is handed
   * a properties-less object schema rejects the tool outright — Codex does.
   * The conversion has to see through the wrapper.
   */
  it('still describes browser_tabs as an object with its fields', () => {
    const tools = buildAgentTools({ sidecarPath: '/fake.js', spawnFn: fakeSidecar().spawn });

    const json = zodToJsonSchema(byName(tools, 'browser_tabs').inputSchema) as {
      type: string;
      properties: Record<string, { type: string }>;
      required: ReadonlyArray<string>;
    };

    expect(json.type).toBe('object');
    expect(json.properties.url?.type).toBe('string');
    expect(json.properties.tab_id?.type).toBe('string');
    expect(json.properties.action?.type).toBe('string');
    // Only `action` is genuinely required — the wrapped fields must not become so.
    expect(json.required).toEqual(['action']);
  });
});
