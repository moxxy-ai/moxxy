/**
 * Cross-level security matrix.
 *
 * Same operation, run under each configuration: security disabled,
 * `none` isolator, `inproc` isolator. The point is regression cover —
 * if any change accidentally breaks the off-by-default contract, or
 * leaks enforcement through `none`, or weakens `inproc`, this file
 * goes red.
 *
 * Worker-level scenarios live in `@moxxy/isolator-worker`'s own tests
 * (the worker package depends on this one; the reverse would be a
 * cycle). Plus they need a real `Worker()` spawn which is heavier
 * setup than this matrix wants.
 */
import { describe, expect, it } from 'vitest';
import type { ToolDef, ToolContext } from '@moxxy/sdk';
import { buildSecurityPlugin, type SecurityToolRegistryLike } from './index.js';

// ---------- shared test fixtures ----------

class FakeRegistry implements SecurityToolRegistryLike {
  private readonly tools = new Map<string, ToolDef>();
  add(t: ToolDef): this {
    this.tools.set(t.name, t);
    return this;
  }
  list(): ReadonlyArray<ToolDef> {
    return [...this.tools.values()];
  }
  get(name: string): ToolDef | undefined {
    return this.tools.get(name);
  }
  has(name: string): boolean {
    return this.tools.has(name);
  }
  register(t: ToolDef): void {
    this.tools.set(t.name, t);
  }
  unregister(name: string): void {
    this.tools.delete(name);
  }
}

const tool = (name: string, over: Partial<ToolDef> = {}): ToolDef => ({
  name,
  description: 'x',
  inputSchema: {} as ToolDef['inputSchema'],
  handler: async (input: unknown) => ({ ran: name, input }),
  ...over,
});

const ctx = (): ToolContext => ({
  sessionId: 's1' as ToolContext['sessionId'],
  turnId: 't1' as ToolContext['turnId'],
  callId: 'c1' as ToolContext['callId'],
  cwd: '/work',
  signal: new AbortController().signal,
  log: {
    length: 0,
    at: () => undefined,
    slice: () => [],
    ofType: () => [],
    byTurn: () => [],
    toJSON: () => [],
  },
  logger: { debug: () => undefined, info: () => undefined, warn: () => undefined, error: () => undefined },
});

const appContext = (): {
  sessionId: ToolContext['sessionId'];
  cwd: string;
  log: ToolContext['log'];
  env: Record<string, string>;
} => ({
  sessionId: 's1' as ToolContext['sessionId'],
  cwd: '/work',
  log: ctx().log,
  env: {},
});

// Bootstrap a plugin + run its onInit so any wrapping has happened.
async function setup(args: {
  config: Parameters<typeof buildSecurityPlugin>[0]['config'];
  tools: ReadonlyArray<ToolDef>;
  resolvePluginForTool?: ((name: string) => string | undefined) | null;
}): Promise<{ registry: FakeRegistry; handle: ReturnType<typeof buildSecurityPlugin> }> {
  const registry = new FakeRegistry();
  for (const t of args.tools) registry.add(t);
  const handle = buildSecurityPlugin({
    config: args.config,
    toolRegistry: registry,
    ...(args.resolvePluginForTool !== undefined
      ? { resolvePluginForTool: args.resolvePluginForTool }
      : {}),
  });
  await handle.plugin.hooks?.onInit?.(appContext());
  return { registry, handle };
}

// ---------- Level 0: security disabled ----------

describe('matrix: security disabled (security.enabled: false)', () => {
  it('declared tools run with their original handler — no wrapping', async () => {
    const t = tool('read', {
      handler: async (input) => ({ raw: input }),
      isolation: { capabilities: { fs: { read: ['$cwd/**'] } } },
    });
    const { registry } = await setup({ config: { enabled: false }, tools: [t] });
    const got = registry.get('read')!;
    // identity check: the handler reference is the same object
    expect(got.handler).toBe(t.handler);
  });

  it('cap violations are not enforced when disabled', async () => {
    const t = tool('read', {
      isolation: { capabilities: { fs: { read: ['$cwd/**'] } } },
    });
    const { registry } = await setup({ config: { enabled: false }, tools: [t] });
    const got = registry.get('read')!;
    // file outside $cwd would be denied if security were enabled
    await expect(got.handler({ file_path: '/etc/passwd' }, ctx())).resolves.toEqual({
      ran: 'read',
      input: { file_path: '/etc/passwd' },
    });
  });

  it('requireDeclaration is ignored when disabled', async () => {
    const t = tool('plain');
    const { handle } = await setup({
      config: { enabled: false, requireDeclaration: true },
      tools: [t],
    });
    const verdict = await handle.plugin.hooks?.onToolCall?.({
      ...appContext(),
      turnId: 't1' as ToolContext['turnId'],
      iteration: 0,
      call: { name: 'plain', input: {} as Record<string, unknown> },
    });
    // No verdict (undefined) means pass through — the disabled hook
    // never blocks anything.
    expect(verdict).toBeUndefined();
  });
});

// ---------- Level 1: enabled + 'none' isolator ----------

describe('matrix: enabled + isolator "none" (passthrough)', () => {
  it('runs the handler unmodified', async () => {
    const t = tool('read', {
      handler: async (input) => input,
      isolation: { capabilities: { fs: { read: ['$cwd/**'] } } },
    });
    const { registry } = await setup({
      config: { enabled: true, isolator: 'none' },
      tools: [t],
    });
    const got = registry.get('read')!;
    // Passthrough: the wrapper exists (handler !== original because we
    // ran through Isolator.run) but the value comes back unchanged.
    await expect(got.handler({ file_path: '/etc/passwd' }, ctx())).resolves.toEqual({
      file_path: '/etc/passwd',
    });
  });

  it('does not enforce caps under "none"', async () => {
    const t = tool('writer', {
      isolation: { capabilities: { fs: { write: ['$cwd/**'] } } },
      handler: async (input) => ({ wrote: input }),
    });
    const { registry } = await setup({
      config: { enabled: true, isolator: 'none' },
      tools: [t],
    });
    await expect(
      registry.get('writer')!.handler({ file_path: '/etc/secret' }, ctx()),
    ).resolves.toEqual({ wrote: { file_path: '/etc/secret' } });
  });
});

// ---------- Level 2: enabled + 'inproc' isolator ----------

describe('matrix: enabled + isolator "inproc" (cap validation + timeout)', () => {
  it('allows cap-compliant fs input', async () => {
    const t = tool('reader', {
      isolation: { capabilities: { fs: { read: ['$cwd/**'] } } },
      handler: async (input) => ({ ok: input }),
    });
    const { registry } = await setup({
      config: { enabled: true, isolator: 'inproc' },
      tools: [t],
    });
    await expect(
      registry.get('reader')!.handler({ file_path: '/work/src/main.ts' }, ctx()),
    ).resolves.toEqual({ ok: { file_path: '/work/src/main.ts' } });
  });

  it('denies fs path outside the declared glob', async () => {
    const t = tool('reader', {
      isolation: { capabilities: { fs: { read: ['$cwd/**'] } } },
    });
    const { registry } = await setup({
      config: { enabled: true, isolator: 'inproc' },
      tools: [t],
    });
    await expect(
      registry.get('reader')!.handler({ file_path: '/etc/passwd' }, ctx()),
    ).rejects.toThrow(/outside the tool's declared fs capability/);
  });

  it('denies URL outside the declared net allowlist', async () => {
    const t = tool('fetcher', {
      isolation: {
        capabilities: {
          net: { mode: 'allowlist', hosts: ['api.example.com'] },
        },
      },
    });
    const { registry } = await setup({
      config: { enabled: true, isolator: 'inproc' },
      tools: [t],
    });
    await expect(
      registry.get('fetcher')!.handler({ url: 'https://evil.com/x' }, ctx()),
    ).rejects.toThrow(/not in the tool's declared net allowlist/);
  });

  it('enforces timeMs', async () => {
    const t = tool('slow', {
      handler: () => new Promise((r) => setTimeout(() => r('done'), 200)),
      isolation: { capabilities: { timeMs: 30 } },
    });
    const { registry } = await setup({
      config: { enabled: true, isolator: 'inproc' },
      tools: [t],
    });
    await expect(registry.get('slow')!.handler({}, ctx())).rejects.toThrow(
      /exceeded 30ms budget/,
    );
  });

  it('propagates an external abort', async () => {
    const t = tool('hang', {
      handler: () => new Promise((r) => setTimeout(r, 5000)),
      isolation: { capabilities: { timeMs: 10_000 } },
    });
    const { registry } = await setup({
      config: { enabled: true, isolator: 'inproc' },
      tools: [t],
    });
    const ctrl = new AbortController();
    const c: ToolContext = { ...ctx(), signal: ctrl.signal };
    const p = registry.get('hang')!.handler({}, c);
    setTimeout(() => ctrl.abort(), 20);
    await expect(p).rejects.toThrow(/aborted/);
  });

  it('leaves undeclared tools alone by default', async () => {
    const t = tool('plain', { handler: async (input) => ({ plain: input }) });
    const { registry } = await setup({
      config: { enabled: true, isolator: 'inproc' },
      tools: [t],
    });
    const got = registry.get('plain')!;
    // No isolation declared → not wrapped → identity handler
    expect(got.handler).toBe(t.handler);
  });
});

// ---------- Config knobs ----------

describe('matrix: requireDeclaration', () => {
  it('denies undeclared tools at hook level', async () => {
    const t = tool('plain');
    const { handle } = await setup({
      config: { enabled: true, requireDeclaration: true },
      tools: [t],
    });
    const verdict = await handle.plugin.hooks?.onToolCall?.({
      ...appContext(),
      turnId: 't1' as ToolContext['turnId'],
      iteration: 0,
      call: { name: 'plain', input: {} as Record<string, unknown> },
    });
    expect(verdict).toBeDefined();
    expect(verdict!.action).toBe('deny');
    if (verdict!.action === 'deny') {
      expect(verdict!.reason).toMatch(/requireDeclaration/);
    }
  });

  it('still allows declared tools', async () => {
    const t = tool('declared', {
      isolation: { capabilities: {} },
    });
    const { handle } = await setup({
      config: { enabled: true, requireDeclaration: true },
      tools: [t],
    });
    const verdict = await handle.plugin.hooks?.onToolCall?.({
      ...appContext(),
      turnId: 't1' as ToolContext['turnId'],
      iteration: 0,
      call: { name: 'declared', input: {} as Record<string, unknown> },
    });
    expect(verdict).toBeUndefined(); // pass through
  });
});

describe('matrix: perTool override', () => {
  it('routes a specific tool through a different isolator', async () => {
    const t = tool('reader', {
      isolation: { capabilities: { fs: { read: ['$cwd/**'] } } },
    });
    // Default is inproc (would deny the out-of-bounds path);
    // perTool sends it to none (which passes anything through).
    const { registry } = await setup({
      config: { enabled: true, isolator: 'inproc', perTool: { reader: 'none' } },
      tools: [t],
    });
    // Out-of-bounds path now allowed because we routed to `none`
    await expect(
      registry.get('reader')!.handler({ file_path: '/etc/passwd' }, ctx()),
    ).resolves.toEqual({ ran: 'reader', input: { file_path: '/etc/passwd' } });
  });
});

describe('matrix: perPlugin override', () => {
  it('routes a plugin\'s tools through a specific isolator', async () => {
    const t1 = tool('plugin-tool', {
      isolation: { capabilities: { fs: { read: ['$cwd/**'] } } },
    });
    const t2 = tool('lone-tool', {
      isolation: { capabilities: { fs: { read: ['$cwd/**'] } } },
    });
    const { registry } = await setup({
      config: {
        enabled: true,
        isolator: 'inproc',
        perPlugin: { '@acme/plugin-x': 'none' },
      },
      tools: [t1, t2],
      resolvePluginForTool: (name) =>
        name === 'plugin-tool' ? '@acme/plugin-x' : undefined,
    });
    // plugin-tool is routed to none → out-of-bounds path passes
    await expect(
      registry.get('plugin-tool')!.handler({ file_path: '/etc/passwd' }, ctx()),
    ).resolves.toBeDefined();
    // lone-tool stays on default inproc → out-of-bounds path denied
    await expect(
      registry.get('lone-tool')!.handler({ file_path: '/etc/passwd' }, ctx()),
    ).rejects.toThrow(/outside/);
  });

  it('perTool wins over perPlugin', async () => {
    const t = tool('special', {
      isolation: { capabilities: { fs: { read: ['$cwd/**'] } } },
    });
    const { handle } = await setup({
      config: {
        enabled: true,
        isolator: 'inproc',
        perTool: { special: 'none' },        // wins
        perPlugin: { '@acme/x': 'inproc' },  // would otherwise apply
      },
      tools: [t],
      resolvePluginForTool: () => '@acme/x',
    });
    const audit = handle.audit().find((e) => e.tool === 'special')!;
    expect(audit.resolvedIsolator).toBe('none');
  });
});

describe('matrix: required-strength mismatch', () => {
  it('denies when the configured isolator is weaker than required', async () => {
    const t = tool('needs-worker', {
      isolation: {
        required: 'worker',
        capabilities: {},
      },
    });
    const { handle } = await setup({
      // Default inproc < required worker → onToolCall must deny.
      config: { enabled: true, isolator: 'inproc' },
      tools: [t],
    });
    const verdict = await handle.plugin.hooks?.onToolCall?.({
      ...appContext(),
      turnId: 't1' as ToolContext['turnId'],
      iteration: 0,
      call: { name: 'needs-worker', input: {} as Record<string, unknown> },
    });
    expect(verdict).toBeDefined();
    expect(verdict!.action).toBe('deny');
    if (verdict!.action === 'deny') {
      expect(verdict!.reason).toMatch(/requires isolation 'worker'/);
    }
  });
});

describe('matrix: unknown isolator', () => {
  it('denies with a clear message when the configured isolator is unregistered', async () => {
    const t = tool('any', { isolation: { capabilities: {} } });
    const { handle } = await setup({
      config: { enabled: true, isolator: 'nosuch-isolator' },
      tools: [t],
    });
    const verdict = await handle.plugin.hooks?.onToolCall?.({
      ...appContext(),
      turnId: 't1' as ToolContext['turnId'],
      iteration: 0,
      call: { name: 'any', input: {} as Record<string, unknown> },
    });
    expect(verdict).toBeDefined();
    expect(verdict!.action).toBe('deny');
    if (verdict!.action === 'deny') {
      expect(verdict!.reason).toMatch(/not registered/);
    }
  });
});

describe('matrix: audit output', () => {
  it('reports declared, required, isolator, and hasModuleRef per tool', async () => {
    const t1 = tool('declared-no-module', {
      isolation: { required: 'inproc', capabilities: { timeMs: 1000 } },
    });
    const t2 = tool('declared-with-module', {
      isolation: {
        capabilities: {},
        handlerModule: { url: 'file:///x.js', export: 'handle' },
      },
    });
    const t3 = tool('plain');
    const { handle } = await setup({
      config: { enabled: true, isolator: 'inproc' },
      tools: [t1, t2, t3],
    });
    const entries = handle.audit();
    expect(entries.find((e) => e.tool === 'declared-no-module')).toMatchObject({
      declared: true,
      required: 'inproc',
      resolvedIsolator: 'inproc',
      hasModuleRef: false,
    });
    expect(entries.find((e) => e.tool === 'declared-with-module')).toMatchObject({
      declared: true,
      resolvedIsolator: 'inproc',
      hasModuleRef: true,
    });
    expect(entries.find((e) => e.tool === 'plain')).toMatchObject({
      declared: false,
      hasModuleRef: false,
    });
  });
});
