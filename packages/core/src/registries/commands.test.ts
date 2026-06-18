import type { CommandDef } from '@moxxy/sdk';
import { describe, expect, it } from 'vitest';
import { CommandRegistry } from './commands.js';

function fakeCommand(name: string, extra: Partial<CommandDef> = {}): CommandDef {
  return {
    name,
    description: `cmd ${name}`,
    handler: () => ({ kind: 'text', text: name }),
    ...extra,
  } as CommandDef;
}

describe('CommandRegistry', () => {
  it('registers, looks up by name and alias, lists, and unregisters', () => {
    const reg = new CommandRegistry();
    reg.register(fakeCommand('help', { aliases: ['h', '?'] }));
    expect(reg.has('help')).toBe(true);
    expect(reg.get('help')?.name).toBe('help');
    expect(reg.get('h')?.name).toBe('help');
    expect(reg.get('?')?.name).toBe('help');
    expect(reg.list().map((c) => c.name)).toEqual(['help']);
    reg.unregister('help');
    expect(reg.has('help')).toBe(false);
    expect(reg.get('h')).toBeUndefined();
  });

  it('throws on a duplicate primary name', () => {
    const reg = new CommandRegistry();
    reg.register(fakeCommand('new'));
    expect(() => reg.register(fakeCommand('new'))).toThrow(/already registered/);
  });

  it('throws on an alias already claimed by another command (as alias or name)', () => {
    const reg = new CommandRegistry();
    reg.register(fakeCommand('compact', { aliases: ['c'] }));
    expect(() => reg.register(fakeCommand('clear', { aliases: ['c'] }))).toThrow(
      /alias already in use/,
    );
    expect(() => reg.register(fakeCommand('compact'))).toThrow(/already registered/);
  });

  it('throws when a new primary name collides with an existing alias', () => {
    const reg = new CommandRegistry();
    reg.register(fakeCommand('compact', { aliases: ['c'] }));
    // 'c' is already an alias of /compact; registering a command literally
    // named 'c' must NOT silently shadow it via direct-lookup precedence.
    expect(() => reg.register(fakeCommand('c'))).toThrow(/already in use as an alias/);
  });

  it('replace() upserts and cleans up the prior definition aliases', () => {
    const reg = new CommandRegistry();
    reg.register(fakeCommand('mode', { aliases: ['m'] }));
    reg.replace(fakeCommand('mode', { aliases: ['md'], description: 'updated' }));
    expect(reg.get('mode')?.description).toBe('updated');
    expect(reg.get('md')?.name).toBe('mode');
    // Old alias is cleaned up.
    expect(reg.get('m')).toBeUndefined();
  });

  it('listForChannel filters channel-scoped commands', () => {
    const reg = new CommandRegistry();
    reg.register(fakeCommand('everywhere'));
    reg.register(fakeCommand('tuionly', { channels: ['tui'] }));
    expect(reg.listForChannel('tui').map((c) => c.name).sort()).toEqual([
      'everywhere',
      'tuionly',
    ]);
    expect(reg.listForChannel('telegram').map((c) => c.name)).toEqual(['everywhere']);
  });
});
