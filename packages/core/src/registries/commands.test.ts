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

  it('replace() refuses to hijack an alias owned by a DIFFERENT command', () => {
    const reg = new CommandRegistry();
    reg.register(fakeCommand('compact', { aliases: ['c'] }));
    reg.register(fakeCommand('clear'));
    // Replacing /clear with an alias 'c' already owned by /compact must throw,
    // not silently steal the alias (register() guards this; replace() now too).
    expect(() => reg.replace(fakeCommand('clear', { aliases: ['c'] }))).toThrow(
      /alias already in use/,
    );
    // /compact still owns 'c'.
    expect(reg.get('c')?.name).toBe('compact');
  });

  it('replace() refuses an alias that collides with another command primary name', () => {
    const reg = new CommandRegistry();
    reg.register(fakeCommand('compact'));
    reg.register(fakeCommand('mode', { aliases: ['m'] }));
    // Re-defining /mode with an alias equal to another command's PRIMARY name
    // would make get() ambiguous — reject it.
    expect(() => reg.replace(fakeCommand('mode', { aliases: ['compact'] }))).toThrow(
      /already in use/,
    );
  });

  it('replace() still allows re-adding the command own primary name as an alias edge case is fine', () => {
    const reg = new CommandRegistry();
    reg.register(fakeCommand('mode', { aliases: ['m'] }));
    // Replacing with the SAME alias set must not throw on the alias it already
    // owns (cleared-then-readded).
    expect(() => reg.replace(fakeCommand('mode', { aliases: ['m'], description: 'x' }))).not.toThrow();
    expect(reg.get('m')?.name).toBe('mode');
  });

  it('register() leaves NO partial state when a later alias collides', () => {
    const reg = new CommandRegistry();
    reg.register(fakeCommand('compact', { aliases: ['cc'] }));
    // The new command's FIRST alias is free, its SECOND ('cc') collides. The
    // registration must throw atomically: neither the command nor its first
    // alias may be left behind.
    expect(() =>
      reg.register(fakeCommand('clear', { aliases: ['fresh', 'cc'] })),
    ).toThrow(/alias already in use/);
    expect(reg.has('clear')).toBe(false);
    expect(reg.get('fresh')).toBeUndefined();
    // The first command is untouched.
    expect(reg.get('cc')?.name).toBe('compact');
  });

  it('replace() leaves the PRIOR definition intact when a new alias collides', () => {
    const reg = new CommandRegistry();
    reg.register(fakeCommand('compact', { aliases: ['c'] }));
    reg.register(fakeCommand('mode', { aliases: ['m'] }));
    // Replacing /mode where the SECOND new alias ('c') is owned by /compact must
    // throw without first destroying /mode's existing alias 'm' (the prior bug:
    // delete-prior-then-add left the registry corrupted on a mid-loop throw).
    expect(() =>
      reg.replace(fakeCommand('mode', { aliases: ['m2', 'c'] })),
    ).toThrow(/alias already in use/);
    // /mode's original def + alias survive untouched.
    expect(reg.get('m')?.name).toBe('mode');
    expect(reg.get('m2')).toBeUndefined();
    // /compact still owns 'c'.
    expect(reg.get('c')?.name).toBe('compact');
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
