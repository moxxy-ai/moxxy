import { afterEach, describe, expect, it } from 'vitest';
import { PassThrough } from 'node:stream';
import { readFileSync } from 'node:fs';
import { buildAgentTools } from './agent-tools.js';
import { JevAccess } from './run/run-tool.js';
import { closeBrowserSidecar, type SidecarStream } from './browser-session.js';
import { zodToJsonSchema } from '@moxxy/sdk';
import type { EventLogReader, MoxxyEvent, ToolContext, ToolDef } from '@moxxy/sdk';

/**
 * The tools the model calls. Driven against a fake sidecar over the real
 * newline-JSON transport, so the wiring under test is the wiring that ships.
 */

interface Fake {
  spawn: (path: string) => SidecarStream;
  received: Array<{ method: string; params: Record<string, unknown> }>;
  setReply: (fn: (method: string) => unknown) => void;
  setReplyRaw: (fn: (method: string) => unknown) => void;
}

function fakeSidecar(): Fake {
  const received: Array<{ method: string; params: Record<string, unknown> }> = [];
  let reply: (method: string) => unknown = () => ({});
  /** Full envelope, for testing what a failing step does. */
  let raw: ((method: string) => unknown) | null = null;
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
        const envelope = raw ? { id: req.id, ...(raw(req.method) as object) } : { id: req.id, ok: true, result: reply(req.method) };
        stdout.write(JSON.stringify(envelope) + '\n');
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
  return {
    spawn,
    received,
    setReply: (fn) => (reply = fn),
    setReplyRaw: (fn: (method: string) => unknown) => (raw = fn),
  };
}

function memoryLog(events: MoxxyEvent[]): EventLogReader {
  return {
    get length() {
      return events.length;
    },
    at: (index) => events[index],
    slice: (from, to) => events.slice(from, to),
    ofType: ((type: MoxxyEvent['type']) => events.filter((event) => event.type === type)) as EventLogReader['ofType'],
    byTurn: (turnId) => events.filter((event) => event.turnId === turnId),
    toJSON: () => events,
  };
}

function ctx(log: EventLogReader = memoryLog([])): ToolContext {
  return {
    sessionId: 's' as never,
    turnId: 't' as never,
    callId: 'c' as never,
    cwd: '/tmp',
    signal: new AbortController().signal,
    log,
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
      'browser_key',
      'browser_batch',
      'browser_history',
      'browser_await_human',
      'browser_select',
      'browser_scroll',
      'browser_hover',
      'browser_wait',
      'browser_dialog',
      'browser_allow_site',
      'browser_point',
      'browser_upload',
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

  it('covers acting by the consent given to the site, and asks for the decisions that are the user’s', () => {
    const tools = buildAgentTools({ sidecarPath: '/fake.js', spawnFn: fakeSidecar().spawn });

    for (const name of ['browser_click', 'browser_type', 'browser_navigate']) {
      expect(byName(tools, name).permission?.action, name).toBe('allow');
    }
    for (const name of ['browser_allow_site', 'browser_dialog', 'browser_upload']) {
      expect(byName(tools, name).permission?.action, name).toBe('prompt');
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

describe('browser_key', () => {
  /**
   * Added because its absence was load-bearing: with no way to press a key, an
   * agent that needed Cmd+A to replace a field's contents went looking for a
   * different browser entirely rather than report that it could not.
   */
  it('sends the key to the same backend as everything else', async () => {
    const fake = fakeSidecar();
    fake.setReply(() => ({ key: 'Meta+a' }));
    const tools = buildAgentTools({ sidecarPath: '/fake.js', spawnFn: fake.spawn });

    await byName(tools, 'browser_key').handler({ key: 'Meta+a', element: 'pole tytulu' }, ctx());

    expect(fake.received[0]?.method).toBe('key');
    expect(fake.received[0]?.params.key).toBe('Meta+a');
  });

  it('is offered on both backends, so a task does not depend on where it runs', () => {
    const tools = buildAgentTools({ sidecarPath: '/fake.js', spawnFn: fakeSidecar().spawn });

    expect(tools.map((t) => t.name)).toContain('browser_key');
  });

  it('is covered by the consent given to the site, like every other tool that acts', () => {
    const tools = buildAgentTools({ sidecarPath: '/fake.js', spawnFn: fakeSidecar().spawn });

    expect(byName(tools, 'browser_key').permission?.action).toBe('allow');
  });

  it('requires a description of what it is pressing on, for the approval to mean anything', () => {
    const tools = buildAgentTools({ sidecarPath: '/fake.js', spawnFn: fakeSidecar().spawn });

    expect(() => byName(tools, 'browser_key').inputSchema.parse({ key: 'Enter' })).toThrow();
  });
});

describe('the browser skill and the tools it names', () => {
  /**
   * The skill drifted: it still described driving pages by CSS selector and its
   * `allowed-tools` listed only `browser_session`, so an agent that loaded it was
   * told to use none of the perception tools. Nothing failed — a skill naming a
   * tool that does not exist is silently dropped, and one omitting a tool that
   * does exist just quietly withholds it.
   *
   * Read off disk rather than imported: this package owns the tools, the skills
   * package owns the file, and neither should depend on the other to say so.
   */
  const skillPath = new URL('../../skills-builtin/skills/browser.md', import.meta.url);

  function allowedTools(): string[] {
    const text = readFileSync(skillPath, 'utf8');
    const line = /^allowed-tools:\s*\[(.*)\]\s*$/m.exec(text);
    if (!line) throw new Error('browser.md has no allowed-tools line');
    return line[1]!.split(',').map((t) => t.trim()).filter(Boolean);
  }

  it('names only tools that exist', () => {
    const shipped = new Set([
      ...buildAgentTools(
        { sidecarPath: '/fake.js', spawnFn: fakeSidecar().spawn },
        { run: { access: new JevAccess() } },
      ).map((t) => t.name),
      // The two the plugin ships alongside them.
      'browser_session',
      'web_fetch',
    ]);

    const unknown = allowedTools().filter((t) => !shipped.has(t));

    expect(unknown, 'the skill names tools nothing ships').toEqual([]);
  });

  it('withholds none of the browser tools from an agent that loaded it', () => {
    const allowed = new Set(allowedTools());
    const shipped = buildAgentTools({ sidecarPath: '/fake.js', spawnFn: fakeSidecar().spawn }).map((t) => t.name);

    const missing = shipped.filter((t) => !allowed.has(t));

    expect(missing, 'the skill would hide these from the agent').toEqual([]);
  });
  it('withholds none of the desktop’s extra tools either', () => {
    const allowed = new Set(allowedTools());
    const shipped = buildAgentTools(
      { sidecarPath: '/fake.js', spawnFn: fakeSidecar().spawn },
      { run: { access: new JevAccess() } },
    ).map((t) => t.name);

    expect(shipped).toContain('browser_run');
    expect(shipped.filter((t) => !allowed.has(t)), 'the skill would hide these from the agent').toEqual([]);
  });
});

describe('browser_batch', () => {
  /**
   * One read per action is the other half of what a heavy page costs. Codex's
   * agent runs `click; setValue; pressKey; ax.write()` in a single call and pays
   * for one read; moxxy paid for a read after every one of those. On Canva that
   * was the difference between a few reads and a few dozen.
   *
   * One approval covers the whole sequence, and the approval shows every step —
   * which is more informative than four prompts answered one after another.
   */
  it('runs the steps in order and reads the page once at the end', async () => {
    const fake = fakeSidecar();
    fake.setReply((m) => (m === 'snapshot' ? { text: 'po wszystkim', tabId: 't1', url: 'https://a.pl', nodes: 3 } : {}));
    const tools = buildAgentTools({ sidecarPath: '/fake.js', spawnFn: fake.spawn });

    const out = (await byName(tools, 'browser_batch').handler(
      {
        element: 'formularz logowania',
        steps: [
          { kind: 'click', uid: '4' },
          { kind: 'type', uid: '5', text: 'moxxy' },
          { kind: 'key', key: 'Enter' },
        ],
      },
      ctx(),
    )) as { text: string; ran: number };

    expect(fake.received.map((r) => r.method)).toEqual(['act', 'act', 'key', 'snapshot']);
    expect(fake.received[0]?.params).toMatchObject({ action: 'click', uid: '4' });
    expect(fake.received[1]?.params).toMatchObject({ action: 'type', uid: '5', text: 'moxxy' });
    expect(fake.received[2]?.params).toMatchObject({ key: 'Enter' });
    expect(out.ran).toBe(3);
    expect(out.text).toBe('po wszystkim');
  });

  it('stops at the first step that fails, and says which', async () => {
    // Carrying on after a failed click would act on a page that is not the page
    // the rest of the sequence was written for.
    const fake = fakeSidecar();
    let seen = 0;
    fake.setReplyRaw((method) => {
      if (method === 'act' && ++seen === 2) return { ok: false, error: { message: 'uid 5 is not in the last snapshot' } };
      return { ok: true, result: method === 'snapshot' ? { text: 'stan', tabId: 't1', url: '', nodes: 0 } : {} };
    });
    const tools = buildAgentTools({ sidecarPath: '/fake.js', spawnFn: fake.spawn });

    await expect(
      byName(tools, 'browser_batch').handler(
        { element: 'formularz', steps: [{ kind: 'click', uid: '4' }, { kind: 'click', uid: '5' }, { kind: 'key', key: 'Enter' }] },
        ctx(),
      ),
    ).rejects.toThrow(/step 2.*uid 5/is);

    expect(fake.received.map((r) => r.method)).toEqual(['act', 'act']);
  });

  it('is covered by the consent given to the site, like every other tool that acts', () => {
    const tools = buildAgentTools({ sidecarPath: '/fake.js', spawnFn: fakeSidecar().spawn });

    expect(byName(tools, 'browser_batch').permission?.action).toBe('allow');
  });

  it('will not run an empty sequence', () => {
    const tools = buildAgentTools({ sidecarPath: '/fake.js', spawnFn: fakeSidecar().spawn });

    expect(() => byName(tools, 'browser_batch').inputSchema.parse({ element: 'x', steps: [] })).toThrow();
  });

  it('describes what it is about to do, for the approval to mean anything', () => {
    const tools = buildAgentTools({ sidecarPath: '/fake.js', spawnFn: fakeSidecar().spawn });

    expect(() =>
      byName(tools, 'browser_batch').inputSchema.parse({ steps: [{ kind: 'key', key: 'Enter' }] }),
    ).toThrow();
  });
});

describe('the tools beyond reading, clicking and typing', () => {
  /**
   * Answer a page's dialog, pick from a native list, scroll, hover, wait for an
   * answer. Both backends serve them through the same browser host — the
   * desktop's pane and the headless sidecar the terminal uses — so a task does
   * not depend on where it runs.
   */
  const desktop = (fake = fakeSidecar()) =>
    buildAgentTools({ sidecarPath: '/fake.js', spawnFn: fake.spawn });
  const EXTRA = ['browser_select', 'browser_scroll', 'browser_hover', 'browser_wait', 'browser_dialog'];

  it('ships them on the desktop and on the headless sidecar alike', () => {
    const names = desktop().map((t) => t.name);
    const sidecar = buildAgentTools({ sidecarPath: '/fake.js', spawnFn: fakeSidecar().spawn }).map((t) => t.name);

    for (const name of EXTRA) expect(names).toContain(name);
    for (const name of EXTRA) expect(sidecar).toContain(name);
  });

  it('names its turn on every call, so the desktop can tell a new request from the one the user stopped', async () => {
    const fake = fakeSidecar();
    const click = byName(desktop(fake), 'browser_click');
    const sidecarClick = byName(buildAgentTools({ sidecarPath: '/fake.js', spawnFn: fake.spawn }), 'browser_click');

    await click.handler(click.inputSchema.parse({ uid: '4', element: 'przycisk Szukaj' }), ctx());
    expect(fake.received.at(-1)?.params).toMatchObject({ turn_id: 't' });
    await sidecarClick.handler(sidecarClick.inputSchema.parse({ uid: '4', element: 'przycisk Szukaj' }), ctx());
    expect(fake.received.at(-1)?.params).toMatchObject({ turn_id: 't' });
  });

  it('can press Enter after typing, in the same call', async () => {
    const fake = fakeSidecar();
    const type = byName(desktop(fake), 'browser_type');

    await type.handler(type.inputSchema.parse({ uid: '4', element: 'pole wyszukiwania', text: 'Marmolada', submit: true }), ctx());

    expect(fake.received.at(-1)).toEqual({
      method: 'act',
      params: { action: 'type', uid: '4', text: 'Marmolada', submit: true, turn_id: 't', sites: [] },
    });
  });

  it('offers submit on the headless sidecar too, which honours it the same way', () => {
    const type = byName(buildAgentTools({ sidecarPath: '/fake.js', spawnFn: fakeSidecar().spawn }), 'browser_type');
    const schema = zodToJsonSchema(type.inputSchema) as { properties?: Record<string, unknown> };

    expect(Object.keys(schema.properties ?? {})).toContain('submit');
  });

  it('answers a dialog, and asks before doing so — the answer is a decision', async () => {
    const fake = fakeSidecar();
    const dialog = byName(desktop(fake), 'browser_dialog');

    await dialog.handler(dialog.inputSchema.parse({ accept: true, element: 'potwierdzenie usunięcia' }), ctx());

    expect(dialog.permission?.action).toBe('prompt');
    expect(fake.received.at(-1)).toEqual({ method: 'dialog', params: { accept: true, turn_id: 't', sites: [] } });
  });

  it('picks an option by its label, covered by the site’s consent like any other action there', async () => {
    const fake = fakeSidecar();
    const select = byName(desktop(fake), 'browser_select');

    await select.handler(select.inputSchema.parse({ uid: '17', option: 'Kraków', element: 'lista Miasto' }), ctx());

    expect(select.permission?.action).toBe('allow');
    expect(fake.received.at(-1)).toEqual({ method: 'select', params: { uid: '17', option: 'Kraków', turn_id: 't', sites: [] } });
  });

  it('scrolls, hovers and waits without asking: none of them decides anything', async () => {
    const fake = fakeSidecar();
    const tools = desktop(fake);
    const scroll = byName(tools, 'browser_scroll');
    const hover = byName(tools, 'browser_hover');
    const wait = byName(tools, 'browser_wait');

    await scroll.handler(scroll.inputSchema.parse({ direction: 'down' }), ctx());
    await hover.handler(hover.inputSchema.parse({ uid: '25', element: 'Menu' }), ctx());
    await wait.handler(wait.inputSchema.parse({ text: 'Znaleziono', timeout_ms: 5000 }), ctx());

    for (const tool of [scroll, hover, wait]) expect(tool.permission?.action).toBe('allow');
    expect(fake.received.slice(-3)).toEqual([
      { method: 'scroll', params: { direction: 'down', turn_id: 't', sites: [] } },
      { method: 'act', params: { action: 'hover', uid: '25', turn_id: 't', sites: [] } },
      { method: 'wait', params: { text: 'Znaleziono', timeoutMs: 5000, turn_id: 't', sites: [] } },
    ]);
  });
});

describe('consent per site, on every backend', () => {
  /**
   * Asking before each action buys nothing but interruptions. The person
   * allows a site once; the approval is a tool result in the session log, which
   * every client of the conversation reads, and the backend — the desktop's or
   * the headless sidecar's, one browser host — refuses actions on any site not
   * allowed yet.
   */
  const desktop = (fake = fakeSidecar()) =>
    buildAgentTools({ sidecarPath: '/fake.js', spawnFn: fake.spawn });
  const sidecar = (fake = fakeSidecar()) => buildAgentTools({ sidecarPath: '/fake.js', spawnFn: fake.spawn });
  const ACTING = ['browser_click', 'browser_type', 'browser_navigate', 'browser_tabs', 'browser_key', 'browser_batch', 'browser_history'];

  const approvedSite = (site: string): MoxxyEvent[] => {
    const base = { sessionId: 's', turnId: 't0', source: 'system', ts: 0 } as const;
    return [
      { ...base, id: 'e1', seq: 0, type: 'tool_call_requested', callId: 'g1', name: 'browser_allow_site', input: { site } },
      { ...base, id: 'e2', seq: 1, type: 'tool_call_approved', callId: 'g1', decidedBy: 'resolver', mode: 'allow' },
      { ...base, id: 'e3', seq: 2, type: 'tool_result', callId: 'g1', ok: true, output: { kind: 'browser_site', site } },
    ] as MoxxyEvent[];
  };

  it('asks for a site once, through a tool of its own, on either backend', async () => {
    const allow = byName(desktop(), 'browser_allow_site');

    const out = await allow.handler(
      allow.inputSchema.parse({ site: 'https://www.canva.com/design/abc', reason: 'Edit the poster you asked for' }),
      ctx(),
    );

    expect(allow.permission?.action).toBe('prompt');
    expect(out).toEqual({ kind: 'browser_site', site: 'canva.com' });
    expect(sidecar().map((t) => t.name)).toContain('browser_allow_site');
  });

  it('refuses to allow something that is not a web site', async () => {
    const allow = byName(desktop(), 'browser_allow_site');

    await expect(
      allow.handler(allow.inputSchema.parse({ site: 'file:///etc/passwd', reason: 'x' }), ctx()),
    ).rejects.toThrow(/not a web site/);
  });

  it('says in every snapshot which sites are already allowed, so the agent never asks twice', async () => {
    const fake = fakeSidecar();
    fake.setReply(() => ({ text: '### Page\n- URL: https://www.canva.com/', tabId: 't1' }));
    const snapshot = byName(desktop(fake), 'browser_snapshot');
    const headless = byName(sidecar(fake), 'browser_snapshot');

    const allowed = (await snapshot.handler({}, ctx(memoryLog(approvedSite('canva.com'))))) as { text: string };
    const none = (await snapshot.handler({}, ctx())) as { text: string };
    const plain = (await headless.handler({}, ctx(memoryLog(approvedSite('canva.com'))))) as { text: string };

    expect(allowed.text).toContain('Sites you may act on: canva.com');
    expect(none.text).toMatch(/Sites you may act on: none yet/);
    expect(plain.text).toContain('Sites you may act on: canva.com');
  });

  it('acts without a prompt per call on either backend', () => {
    const tools = desktop();
    const headless = sidecar();

    for (const name of ACTING) {
      expect(byName(tools, name).permission?.action, name).toBe('allow');
      expect(byName(headless, name).permission?.action, name).toBe('allow');
    }
    expect(byName(tools, 'browser_dialog').permission?.action).toBe('prompt');
  });

  it('sends the sites the conversation allowed with every call, to either backend', async () => {
    const fake = fakeSidecar();
    const click = byName(desktop(fake), 'browser_click');
    const sidecarClick = byName(sidecar(fake), 'browser_click');
    const log = memoryLog(approvedSite('canva.com'));

    await click.handler(click.inputSchema.parse({ uid: '4', element: 'Udostępnij' }), ctx(log));
    expect(fake.received.at(-1)?.params).toMatchObject({ sites: ['canva.com'] });
    await sidecarClick.handler(sidecarClick.inputSchema.parse({ uid: '4', element: 'Udostępnij' }), ctx(log));
    expect(fake.received.at(-1)?.params).toMatchObject({ sites: ['canva.com'] });
  });
});

describe('working by picture, and giving files, on every backend', () => {
  const desktop = (fake = fakeSidecar()) =>
    buildAgentTools({ sidecarPath: '/fake.js', spawnFn: fake.spawn });
  const sidecar = () => buildAgentTools({ sidecarPath: '/fake.js', spawnFn: fakeSidecar().spawn });

  it('points at a picture under the site’s consent, on either backend', async () => {
    const fake = fakeSidecar();
    const point = byName(desktop(fake), 'browser_point');

    await point.handler(
      point.inputSchema.parse({ action: 'drag', x: 10, y: 20, path: [[30, 40]], view: 'v3', element: 'prostokąt na płótnie' }),
      ctx(),
    );

    expect(point.permission?.action).toBe('allow');
    expect(fake.received.at(-1)).toEqual({
      method: 'point',
      params: { action: 'drag', x: 10, y: 20, path: [[30, 40]], view: 'v3', turn_id: 't', sites: [] },
    });
    expect(sidecar().map((t) => t.name)).toContain('browser_point');
  });

  it('asks before every upload — the files are the user’s — and sends absolute paths', async () => {
    const fake = fakeSidecar();
    const upload = byName(desktop(fake), 'browser_upload');

    await upload.handler(
      upload.inputSchema.parse({ uid: '9', paths: ['raport.pdf', '/abs/zdjecie.png'], element: 'Dodaj załącznik' }),
      ctx(),
    );

    expect(upload.permission?.action).toBe('prompt');
    expect(fake.received.at(-1)).toEqual({
      method: 'upload',
      params: { uid: '9', paths: ['/tmp/raport.pdf', '/abs/zdjecie.png'], turn_id: 't', sites: [] },
    });
    expect(sidecar().map((t) => t.name)).toContain('browser_upload');
  });

  it('tells the model that a picture is something to point at, on either backend', () => {
    expect(byName(desktop(), 'browser_capture').description).toContain('browser_point');
    expect(byName(sidecar(), 'browser_capture').description).toContain('browser_point');
  });
});

describe('runs of steps, on every backend', () => {
  it('offers browser_run on either backend, and every browser call notices whether there is a key', async () => {
    const access = new JevAccess();
    const fake = fakeSidecar();
    fake.setReply(() => ({ text: 'strona', tabId: 't1', url: 'https://a.pl', nodes: 1 }));
    const tools = buildAgentTools({ sidecarPath: '/fake.js', spawnFn: fake.spawn }, { run: { access } });
    const sidecar = buildAgentTools({ sidecarPath: '/fake.js', spawnFn: fakeSidecar().spawn }, { run: { access } });

    expect(tools.map((t) => t.name)).toContain('browser_run');
    expect(sidecar.map((t) => t.name)).toContain('browser_run');

    const snapshot = byName(tools, 'browser_snapshot');
    await snapshot.handler(snapshot.inputSchema.parse({}), { ...ctx(), getSecret: async (name: string) => (name === 'TYPESAFE_API_KEY' ? 'k' : null) });
    expect(access.on('s')).toBe(true);
  });
});
