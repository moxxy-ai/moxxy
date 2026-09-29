import { describe, expect, it } from 'vitest';
import type { ParsedArgv } from '../argv.js';
import { wantsInteractiveSetup, wizardHandoffArgv } from './channel-wizard-routing.js';

const withWizard = { interactiveCommand: 'setup' } as const;
const argv = (flags: ParsedArgv['flags'] = {}): ParsedArgv => ({
  command: 'discord',
  flags,
  positional: [],
});

describe('wantsInteractiveSetup', () => {
  it('opens the channel wizard for a plain TTY invocation', () => {
    expect(wantsInteractiveSetup(withWizard, argv(), true)).toBe(true);
  });

  it.each([
    ['no TTY (cron / systemd / piped)', {}, false],
    ['--no-wizard', { 'no-wizard': true }, true],
    ['--standalone', { standalone: true }, true],
  ] as const)('stays headless with %s', (_case, flags, isTTY) => {
    expect(wantsInteractiveSetup(withWizard, argv(flags), isTTY)).toBe(false);
  });

  it('stays headless for a channel without an interactive command', () => {
    expect(wantsInteractiveSetup({}, argv(), true)).toBe(false);
  });
});

describe('wizardHandoffArgv', () => {
  it('never routes a wizard "Start the bot" hand-off back into the wizard (no menu loop)', () => {
    const handoff = wizardHandoffArgv(argv(), {});
    expect(wantsInteractiveSetup(withWizard, handoff, true)).toBe(false);
  });

  it('keeps the original flags, adds the extra start options, and drops positionals', () => {
    const original: ParsedArgv = { command: 'discord', flags: { verbose: true }, positional: ['setup'] };
    const handoff = wizardHandoffArgv(original, { pair: true, allowedTools: 'Read' });
    expect(handoff.command).toBe('discord');
    expect(handoff.positional).toEqual([]);
    expect(handoff.flags).toMatchObject({ verbose: true, pair: true, allowedTools: 'Read' });
  });

  it('cannot be talked back into the wizard by an extra start option', () => {
    const handoff = wizardHandoffArgv(argv(), { __skipWizard: false });
    expect(wantsInteractiveSetup(withWizard, handoff, true)).toBe(false);
  });
});
