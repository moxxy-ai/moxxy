import { describe, it, expect } from 'vitest';
import { stepsForCommand, subcommandForCommand, quote } from './steppers';

describe('stepsForCommand', () => {
  it('returns the two-field schema for the real single-token `vault` command', () => {
    const steps = stepsForCommand('vault');
    expect(steps).toHaveLength(2);
    expect(steps[0]?.label).toBe('Vault key');
    expect(steps[1]?.secret).toBe(true);
  });

  it('returns no steps for commands without an arg schema', () => {
    expect(stepsForCommand('info')).toEqual([]);
    expect(stepsForCommand('clear')).toEqual([]);
  });

  it('does NOT fuzzy-match multi-token names that no command registers', () => {
    // Before the fix the keys were multi-token ('vault set', 'mode use', …)
    // and a startsWith fallback mis-fired. The runner only ever exposes the
    // single-token `vault`, so these must yield no schema.
    expect(stepsForCommand('vault set')).toEqual([]);
    expect(stepsForCommand('mode')).toEqual([]);
    expect(stepsForCommand('provider')).toEqual([]);
  });
});

describe('subcommandForCommand', () => {
  it('returns the `set` subcommand for vault so dispatch routes correctly', () => {
    expect(subcommandForCommand('vault')).toBe('set');
  });

  it('returns undefined for commands with no implicit subcommand', () => {
    expect(subcommandForCommand('info')).toBeUndefined();
  });
});

describe('vault arg construction round-trip', () => {
  // Mirrors CommandPalette.run(): prepend the subcommand, quote values, join.
  function buildArgString(commandName: string, values: ReadonlyArray<string>): string {
    const sub = subcommandForCommand(commandName);
    return [...(sub ? [sub] : []), ...values.map(quote)].join(' ');
  }

  it('builds `set <key> <value>` so the vault handler does not reject it', () => {
    expect(buildArgString('vault', ['OPENAI_API_KEY', 'sk-abc'])).toBe(
      'set OPENAI_API_KEY sk-abc',
    );
  });

  it('quotes values containing spaces', () => {
    expect(buildArgString('vault', ['MY_KEY', 'a b'])).toBe('set MY_KEY "a b"');
  });
});
