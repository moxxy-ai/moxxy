import { describe, expect, it, vi } from 'vitest';
import type { ToolCallContext, ToolDef, ToolContext } from '@moxxy/sdk';
import {
  buildSecurityPlugin,
  wrapWithIsolator,
  isSecurityWrapped,
  IsolatorRegistry,
  type SecurityToolRegistryLike,
} from './index.js';

class FakeToolRegistry implements SecurityToolRegistryLike {
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

const fakeTool = (over: Partial<ToolDef> = {}): ToolDef => ({
  name: 'echo',
  description: 'echo input',
  inputSchema: {} as ToolDef['inputSchema'],
  handler: async (input: unknown) => input,
  ...over,
});

const fakeCtx = (over: Partial<ToolContext> = {}): ToolContext => ({
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
  ...over,
});

describe('buildSecurityPlugin', () => {
  it('is a no-op when enabled: false', async () => {
    const reg = new FakeToolRegistry().add(
      fakeTool({
        isolation: { capabilities: { fs: { read: ['$cwd/**'] } } },
      }),
    );
    const handle = buildSecurityPlugin({
      config: { enabled: false },
      toolRegistry: reg,
    });
    // onInit should leave the registry untouched
    await handle.plugin.hooks?.onInit?.({
      sessionId: 's1' as ToolContext['sessionId'],
      cwd: '/work',
      log: {
        length: 0,
        at: () => undefined,
        slice: () => [],
        ofType: () => [],
        byTurn: () => [],
        toJSON: () => [],
      },
      env: {},
    });
    const tool = reg.get('echo')!;
    const out = await tool.handler({ file: '/etc/passwd' }, fakeCtx());
    expect(out).toEqual({ file: '/etc/passwd' });
  });

  it('wraps a declared-isolation tool when enabled', async () => {
    const reg = new FakeToolRegistry().add(
      fakeTool({
        isolation: { capabilities: { fs: { read: ['$cwd/**'] } } },
      }),
    );
    const handle = buildSecurityPlugin({
      config: { enabled: true, isolator: 'inproc' },
      toolRegistry: reg,
    });
    await handle.plugin.hooks?.onInit?.({
      sessionId: 's1' as ToolContext['sessionId'],
      cwd: '/work',
      log: {
        length: 0,
        at: () => undefined,
        slice: () => [],
        ofType: () => [],
        byTurn: () => [],
        toJSON: () => [],
      },
      env: {},
    });
    const wrapped = reg.get('echo')!;
    // In-bound path is fine
    await expect(wrapped.handler({ file: '/work/x.ts' }, fakeCtx())).resolves.toEqual({
      file: '/work/x.ts',
    });
    // Out-of-bound path now denied by the inproc isolator
    await expect(wrapped.handler({ file: '/etc/passwd' }, fakeCtx())).rejects.toThrow(
      /outside the tool's declared fs capability/,
    );
  });

  it('leaves undeclared tools alone unless requireDeclaration is set', async () => {
    const reg = new FakeToolRegistry().add(fakeTool());
    const handle = buildSecurityPlugin({
      config: { enabled: true },
      toolRegistry: reg,
    });
    await handle.plugin.hooks?.onInit?.({
      sessionId: 's1' as ToolContext['sessionId'],
      cwd: '/work',
      log: {
        length: 0,
        at: () => undefined,
        slice: () => [],
        ofType: () => [],
        byTurn: () => [],
        toJSON: () => [],
      },
      env: {},
    });
    // Tool was not wrapped because it has no isolation declaration
    const tool = reg.get('echo')!;
    await expect(tool.handler({ x: 1 }, fakeCtx())).resolves.toEqual({ x: 1 });
  });

  it('audit() reports declaration status per tool', () => {
    const reg = new FakeToolRegistry()
      .add(fakeTool({ name: 'a', isolation: { capabilities: { timeMs: 1000 } } }))
      .add(fakeTool({ name: 'b' }));
    const handle = buildSecurityPlugin({
      config: { enabled: true },
      toolRegistry: reg,
    });
    const entries = handle.audit();
    expect(entries).toHaveLength(2);
    expect(entries.find((e) => e.tool === 'a')?.declared).toBe(true);
    expect(entries.find((e) => e.tool === 'b')?.declared).toBe(false);
  });

  it('audit() attributes tools to plugins when resolvePluginForTool is wired', () => {
    const reg = new FakeToolRegistry()
      .add(fakeTool({ name: 'a', isolation: { capabilities: { timeMs: 1000 } } }))
      .add(fakeTool({ name: 'b' }));
    const handle = buildSecurityPlugin({
      config: { enabled: true },
      toolRegistry: reg,
      resolvePluginForTool: (name) => (name === 'a' ? '@moxxy/plugin-a' : undefined),
    });
    const entries = handle.audit();
    expect(entries.find((e) => e.tool === 'a')?.plugin).toBe('@moxxy/plugin-a');
    // Unattributed tools omit the field rather than carrying a placeholder.
    expect(entries.find((e) => e.tool === 'b')?.plugin).toBeUndefined();
  });

  it('audit() omits plugin attribution when routing is disabled (null)', () => {
    const reg = new FakeToolRegistry().add(fakeTool({ name: 'a' }));
    const handle = buildSecurityPlugin({
      config: { enabled: true },
      toolRegistry: reg,
      resolvePluginForTool: null,
    });
    expect(handle.audit()[0]?.plugin).toBeUndefined();
  });
});

// u105-2 regression: re-running onInit must NOT double-wrap.
describe('wrapDeclaredTools idempotency (u105-2)', () => {
  const onInit = async (handle: ReturnType<typeof buildSecurityPlugin>): Promise<void> => {
    await handle.plugin.hooks?.onInit?.({
      sessionId: 's1' as ToolContext['sessionId'],
      cwd: '/work',
      log: {
        length: 0,
        at: () => undefined,
        slice: () => [],
        ofType: () => [],
        byTurn: () => [],
        toJSON: () => [],
      },
      env: {},
    });
  };

  it('invokes the underlying handler exactly once after two onInit passes', async () => {
    let calls = 0;
    const reg = new FakeToolRegistry().add(
      fakeTool({
        handler: async (input: unknown) => {
          calls++;
          return input;
        },
        isolation: { capabilities: { fs: { read: ['$cwd/**'] } } },
      }),
    );
    const handle = buildSecurityPlugin({
      config: { enabled: true, isolator: 'inproc' },
      toolRegistry: reg,
    });
    await onInit(handle);
    await onInit(handle); // second pass — must be a no-op for already-wrapped tools

    const wrapped = reg.get('echo')!;
    await expect(wrapped.handler({ file: '/work/ok.ts' }, fakeCtx())).resolves.toEqual({
      file: '/work/ok.ts',
    });
    // A double-wrap would run the real handler twice (nested iso.run); assert once.
    expect(calls).toBe(1);
  });

  it('produces a single timeout layer after two onInit passes', async () => {
    const reg = new FakeToolRegistry().add(
      fakeTool({
        // Never resolves on its own — only the isolation timeout ends it.
        handler: () => new Promise(() => undefined),
        isolation: { capabilities: { timeMs: 20 } },
      }),
    );
    const handle = buildSecurityPlugin({
      config: { enabled: true, isolator: 'inproc' },
      toolRegistry: reg,
    });
    await onInit(handle);
    await onInit(handle);

    const wrapped = reg.get('echo')!;
    // Single isolation layer → exactly one "exceeded budget" rejection. A
    // double-wrap would nest two timers/promises.
    await expect(wrapped.handler({}, fakeCtx())).rejects.toThrow(/exceeded 20ms budget/);
  });
});

// Build a ToolCallContext for invoking the onToolCall hook directly.
const fakeToolCallCtx = (
  name: string,
  input: unknown,
  cwd = '/work',
): ToolCallContext => ({
  sessionId: 's1' as ToolCallContext['sessionId'],
  turnId: 't1' as ToolCallContext['turnId'],
  iteration: 0,
  cwd,
  log: {
    length: 0,
    at: () => undefined,
    slice: () => [],
    ofType: () => [],
    byTurn: () => [],
    toJSON: () => [],
  },
  env: {},
  call: { callId: 'c1' as ToolCallContext['call']['callId'], name, input },
});

// HIGH (audit): tools registered AFTER onInit (MCP attach mid-session, hot
// reload, dynamic registration) are never wrapped by wrapDeclaredTools, so
// onToolCall must be the authoritative cap enforcement point for them.
describe('onToolCall enforces caps on tools registered after onInit', () => {
  const runInit = async (handle: ReturnType<typeof buildSecurityPlugin>): Promise<void> => {
    await handle.plugin.hooks?.onInit?.({
      sessionId: 's1' as ToolContext['sessionId'],
      cwd: '/work',
      log: {
        length: 0,
        at: () => undefined,
        slice: () => [],
        ofType: () => [],
        byTurn: () => [],
        toJSON: () => [],
      },
      env: {},
    });
  };

  it('denies an out-of-scope fs path for a tool added post-init (unwrapped)', async () => {
    const reg = new FakeToolRegistry();
    const handle = buildSecurityPlugin({
      config: { enabled: true, isolator: 'inproc' },
      toolRegistry: reg,
    });
    await runInit(handle); // registry empty at onInit time

    // Tool appears AFTER onInit — never went through wrapDeclaredTools.
    reg.add(fakeTool({ name: 'late', isolation: { capabilities: { fs: { read: ['$cwd/**'] } } } }));
    const v = await handle.plugin.hooks?.onToolCall?.(
      fakeToolCallCtx('late', { file: '/etc/passwd' }),
    );
    expect(v).toEqual({ action: 'deny', reason: expect.stringMatching(/outside the tool's declared fs/) });
  });

  it('allows an in-scope fs path for a post-init tool', async () => {
    const reg = new FakeToolRegistry();
    const handle = buildSecurityPlugin({
      config: { enabled: true, isolator: 'inproc' },
      toolRegistry: reg,
    });
    await runInit(handle);
    reg.add(fakeTool({ name: 'late', isolation: { capabilities: { fs: { read: ['$cwd/**'] } } } }));
    const v = await handle.plugin.hooks?.onToolCall?.(
      fakeToolCallCtx('late', { file: '/work/ok.ts' }),
    );
    expect(v).toBeUndefined();
  });

  it('strict mode denies an out-of-scope path under an UNRECOGNIZED key', async () => {
    const reg = new FakeToolRegistry();
    const handle = buildSecurityPlugin({
      config: { enabled: true, isolator: 'inproc', strict: true },
      toolRegistry: reg,
    });
    await runInit(handle);
    reg.add(fakeTool({ name: 'late', isolation: { capabilities: { fs: { read: ['$cwd/**'] } } } }));
    // `manifest` is not a PATH_WORD; without strict it would be allowed.
    const v = await handle.plugin.hooks?.onToolCall?.(
      fakeToolCallCtx('late', { manifest: '/etc/shadow' }),
    );
    expect(v).toEqual({ action: 'deny', reason: expect.stringMatching(/outside the tool's declared fs/) });
  });

  it('does NOT cap-check a tool that WAS wrapped at onInit (avoids double enforcement)', async () => {
    const reg = new FakeToolRegistry().add(
      fakeTool({ name: 'early', isolation: { capabilities: { fs: { read: ['$cwd/**'] } } } }),
    );
    const handle = buildSecurityPlugin({
      config: { enabled: true, isolator: 'inproc' },
      toolRegistry: reg,
    });
    await runInit(handle); // 'early' gets wrapped here
    // The wrapped handler enforces caps; onToolCall must defer (return undefined)
    // so we don't deny based on a stale/looser read of the same input.
    const v = await handle.plugin.hooks?.onToolCall?.(
      fakeToolCallCtx('early', { file: '/etc/passwd' }),
    );
    expect(v).toBeUndefined();
  });
});

// Phase 4.3: the requireDeclaration ratchet for third-party plugins — tools
// with NO isolation spec from packages outside the @moxxy scope get warned
// about (grace mode, the default) or denied ('enforce'). First-party and
// unattributed tools are exempt.
describe('thirdPartyRequireDeclaration ratchet', () => {
  const build = (
    over: Partial<Parameters<typeof buildSecurityPlugin>[0]['config']> = {},
    resolve: ((name: string) => string | undefined) | null = (name) =>
      name === 'evil' ? 'evil-plugin' : name === 'good' ? '@moxxy/plugin-good' : undefined,
    logger?: { warn(msg: string, meta?: Record<string, unknown>): void },
  ) => {
    const reg = new FakeToolRegistry()
      .add(fakeTool({ name: 'evil' }))
      .add(fakeTool({ name: 'good' }))
      .add(fakeTool({ name: 'mystery' })); // no resolvable owner (e.g. MCP)
    return buildSecurityPlugin({
      config: { enabled: true, ...over },
      toolRegistry: reg,
      resolvePluginForTool: resolve,
      ...(logger ? { logger } : {}),
    });
  };

  it("'enforce' denies an undeclared third-party tool, naming the flag", async () => {
    const handle = build({ thirdPartyRequireDeclaration: 'enforce' });
    const v = await handle.plugin.hooks?.onToolCall?.(fakeToolCallCtx('evil', {}));
    expect(v).toEqual({
      action: 'deny',
      reason: expect.stringContaining('security.thirdPartyRequireDeclaration=enforce'),
    });
    expect((v as { reason: string }).reason).toContain('evil-plugin');
  });

  it("'enforce' still allows undeclared FIRST-PARTY tools", async () => {
    const handle = build({ thirdPartyRequireDeclaration: 'enforce' });
    const v = await handle.plugin.hooks?.onToolCall?.(fakeToolCallCtx('good', {}));
    expect(v).toBeUndefined();
  });

  it("'enforce' exempts unattributed tools (no resolvable owner)", async () => {
    const handle = build({ thirdPartyRequireDeclaration: 'enforce' });
    const v = await handle.plugin.hooks?.onToolCall?.(fakeToolCallCtx('mystery', {}));
    expect(v).toBeUndefined();
  });

  it('defaults to warn (grace mode): allows the call but logs a structured warning', async () => {
    const warn = vi.fn();
    const handle = build({}, undefined, { warn }); // thirdPartyRequireDeclaration unset
    const v = await handle.plugin.hooks?.onToolCall?.(fakeToolCallCtx('evil', {}));
    expect(v).toBeUndefined();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("third-party tool 'evil'"),
      expect.objectContaining({ tool: 'evil', plugin: 'evil-plugin', mode: 'warn' }),
    );
  });

  it('warns ONCE per tool name — repeated calls do not spam', async () => {
    const warn = vi.fn();
    const handle = build({ thirdPartyRequireDeclaration: 'warn' }, undefined, { warn });
    await handle.plugin.hooks?.onToolCall?.(fakeToolCallCtx('evil', {}));
    await handle.plugin.hooks?.onToolCall?.(fakeToolCallCtx('evil', {}));
    await handle.plugin.hooks?.onToolCall?.(fakeToolCallCtx('evil', {}));
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('warn mode does not warn about first-party or unattributed tools', async () => {
    const warn = vi.fn();
    const handle = build({ thirdPartyRequireDeclaration: 'warn' }, undefined, { warn });
    await handle.plugin.hooks?.onToolCall?.(fakeToolCallCtx('good', {}));
    await handle.plugin.hooks?.onToolCall?.(fakeToolCallCtx('mystery', {}));
    expect(warn).not.toHaveBeenCalled();
  });

  it("'off' disables the ratchet entirely", async () => {
    const warn = vi.fn();
    const handle = build({ thirdPartyRequireDeclaration: 'off' }, undefined, { warn });
    const v = await handle.plugin.hooks?.onToolCall?.(fakeToolCallCtx('evil', {}));
    expect(v).toBeUndefined();
    expect(warn).not.toHaveBeenCalled();
  });

  it('the global requireDeclaration deny wins before the ratchet runs', async () => {
    const warn = vi.fn();
    const handle = build(
      { requireDeclaration: true, thirdPartyRequireDeclaration: 'warn' },
      undefined,
      { warn },
    );
    const v = await handle.plugin.hooks?.onToolCall?.(fakeToolCallCtx('evil', {}));
    expect(v).toEqual({
      action: 'deny',
      reason: expect.stringContaining('security.requireDeclaration'),
    });
    expect(warn).not.toHaveBeenCalled();
  });

  it('a tool WITH a declaration never hits the ratchet', async () => {
    const reg = new FakeToolRegistry().add(
      fakeTool({ name: 'evil', isolation: { capabilities: { fs: { read: ['$cwd/**'] } } } }),
    );
    const warn = vi.fn();
    const handle = buildSecurityPlugin({
      config: { enabled: true, isolator: 'inproc', thirdPartyRequireDeclaration: 'enforce' },
      toolRegistry: reg,
      resolvePluginForTool: () => 'evil-plugin',
      logger: { warn },
    });
    const v = await handle.plugin.hooks?.onToolCall?.(
      fakeToolCallCtx('evil', { file: '/work/ok.ts' }),
    );
    expect(v).toBeUndefined();
    expect(warn).not.toHaveBeenCalled();
  });
});

describe('wrapWithIsolator', () => {
  it('returns the tool unchanged when no isolation is declared', () => {
    const t = fakeTool();
    expect(wrapWithIsolator(t, new IsolatorRegistry(), 'inproc')).toBe(t);
  });

  it('returns the tool unchanged when the isolator name is unknown', () => {
    const t = fakeTool({ isolation: { capabilities: {} } });
    expect(wrapWithIsolator(t, new IsolatorRegistry(), 'no-such-thing')).toBe(t);
  });

  it('marks a wrapped tool so a second wrap pass skips it', () => {
    const reg = new IsolatorRegistry();
    const t = fakeTool({ isolation: { capabilities: { timeMs: 100 } } });
    const wrapped = wrapWithIsolator(t, reg, 'inproc');
    expect(wrapped).not.toBe(t);
    expect(isSecurityWrapped(t)).toBe(false);
    expect(isSecurityWrapped(wrapped)).toBe(true);
  });
});
