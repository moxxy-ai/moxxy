import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { defineTool } from '@moxxy/sdk';
import { silentLogger } from '../logger.js';
import { ToolRegistryImpl } from './tools.js';

describe('ToolRegistryImpl', () => {
  const make = () => new ToolRegistryImpl({ logger: silentLogger, cwd: '/tmp' });

  it('registers, lists, and looks up tools', () => {
    const reg = make();
    const tool = defineTool({
      name: 'echo',
      description: 'e',
      inputSchema: z.object({ msg: z.string() }),
      handler: (i) => i.msg,
    });
    reg.register(tool);
    expect(reg.list()).toHaveLength(1);
    expect(reg.has('echo')).toBe(true);
    expect(reg.get('echo')?.name).toBe('echo');
  });

  it('rejects duplicate registration', () => {
    const reg = make();
    const tool = defineTool({
      name: 'echo',
      description: 'e',
      inputSchema: z.string(),
      handler: (s) => s,
    });
    reg.register(tool);
    expect(() => reg.register(tool)).toThrow(/already registered/);
  });

  it('throws on unknown tool', async () => {
    const reg = make();
    await expect(reg.execute('nope', {}, new AbortController().signal)).rejects.toThrow(/Unknown tool/);
  });

  it('validates input via schema', async () => {
    const reg = make();
    reg.register(
      defineTool({
        name: 'echo',
        description: 'e',
        inputSchema: z.object({ msg: z.string() }),
        handler: (i) => i.msg.toUpperCase(),
      }),
    );
    await expect(
      reg.execute('echo', { msg: 123 }, new AbortController().signal),
    ).rejects.toThrow(/Expected string/);
    const result = await reg.execute('echo', { msg: 'hi' }, new AbortController().signal);
    expect(result).toBe('HI');
  });

  it('validates output if outputSchema present, formatting the issues into one line', async () => {
    const reg = make();
    reg.register(
      defineTool({
        name: 'badShape',
        description: 'e',
        inputSchema: z.object({}),
        outputSchema: z.object({ ok: z.literal(true) }),
        handler: () => ({ ok: false }) as never,
      }),
    );
    // Mirrors the input path: names the tool + offending field on a single
    // line instead of dumping the raw multi-line ZodError.
    await expect(
      reg.execute('badShape', {}, new AbortController().signal),
    ).rejects.toThrow(/Tool badShape produced invalid output: ok: /);
  });

  it('returns the parsed output when outputSchema passes', async () => {
    const reg = make();
    reg.register(
      defineTool({
        name: 'goodShape',
        description: 'e',
        inputSchema: z.object({}),
        outputSchema: z.object({ ok: z.literal(true) }),
        handler: () => ({ ok: true, extra: 'stripped' }) as never,
      }),
    );
    // outputSchema.safeParse strips unknown keys exactly like the prior .parse did.
    const result = await reg.execute('goodShape', {}, new AbortController().signal);
    expect(result).toEqual({ ok: true });
  });

  it('unregisters', () => {
    const reg = make();
    const tool = defineTool({
      name: 'echo',
      description: 'e',
      inputSchema: z.string(),
      handler: (s) => s,
    });
    reg.register(tool);
    reg.unregister('echo');
    expect(reg.has('echo')).toBe(false);
  });

  it('exposes ctx.getSecret backed by the secretResolver', async () => {
    const secrets: Record<string, string> = { ELEVENLABS_API_KEY: 'sk-123' };
    const reg = new ToolRegistryImpl({
      logger: silentLogger,
      cwd: '/tmp',
      secretResolver: async (name) => secrets[name] ?? null,
    });
    reg.register(
      defineTool({
        name: 'reads_secret',
        description: 'reads a secret',
        inputSchema: z.object({ name: z.string() }),
        handler: async ({ name }, ctx) => ({
          hasGetSecret: typeof ctx.getSecret === 'function',
          value: (await ctx.getSecret?.(name)) ?? null,
        }),
      }),
    );
    const hit = await reg.execute('reads_secret', { name: 'ELEVENLABS_API_KEY' }, new AbortController().signal);
    expect(hit).toEqual({ hasGetSecret: true, value: 'sk-123' });
    const miss = await reg.execute('reads_secret', { name: 'NOPE' }, new AbortController().signal);
    expect(miss).toEqual({ hasGetSecret: true, value: null });
  });

  it('omits ctx.getSecret when no secretResolver is wired', async () => {
    const reg = make();
    reg.register(
      defineTool({
        name: 'no_secret',
        description: 'no secret resolver',
        inputSchema: z.object({}),
        handler: async (_i, ctx) => ({ hasGetSecret: typeof ctx.getSecret === 'function' }),
      }),
    );
    const result = await reg.execute('no_secret', {}, new AbortController().signal);
    expect(result).toEqual({ hasGetSecret: false });
  });
});
