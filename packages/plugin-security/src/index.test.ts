import { describe, expect, it } from 'vitest';
import type { ToolDef, ToolContext } from '@moxxy/sdk';
import {
  buildSecurityPlugin,
  wrapWithIsolator,
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
});
