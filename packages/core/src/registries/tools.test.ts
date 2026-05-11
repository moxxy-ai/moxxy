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

  it('validates output if outputSchema present', async () => {
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
    await expect(
      reg.execute('badShape', {}, new AbortController().signal),
    ).rejects.toThrow(/Invalid literal value/);
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
});
