import { afterEach, describe, expect, it, vi } from 'vitest';
import { CommandRegistry } from '@moxxy/core';
import { defineCommand, type CommandOutput } from '@moxxy/sdk';
import type { ParsedArgv } from '../argv.js';
import { browserArgs, runBrowserIn } from './browser.js';

/**
 * `moxxy browser …` runs the browser extension's `/browser` — the sign-ins of
 * the terminal's browser — so the terminal and the TUI share one command.
 */

function registryWith(answer: (args: string) => CommandOutput): { commands: CommandRegistry; seen: string[] } {
  const seen: string[] = [];
  const commands = new CommandRegistry();
  commands.register(
    defineCommand({
      name: 'browser',
      description: 'sign-ins',
      handler: ({ args, channel }) => {
        seen.push(`${channel}:${args}`);
        return answer(args);
      },
    }),
  );
  return { commands, seen };
}

const argv = (positional: string[], flags: Record<string, string | boolean> = {}): ParsedArgv =>
  ({ command: 'browser', positional, flags }) as ParsedArgv;

afterEach(() => vi.restoreAllMocks());

describe('moxxy browser', () => {
  it('passes what follows it to /browser, --all included', () => {
    expect(browserArgs(argv(['login', 'canva.com']))).toBe('login canva.com');
    expect(browserArgs(argv(['logout'], { all: true }))).toBe('logout --all');
  });

  it('prints what /browser says, and exits 0', async () => {
    const out: string[] = [];
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => (out.push(String(chunk)), true));
    const { commands, seen } = registryWith(() => ({ kind: 'text', text: 'Saved sign-ins:\n  canva.com' }));

    expect(await runBrowserIn(commands, 'sites')).toBe(0);
    expect(seen).toEqual(['cli:sites']);
    expect(out.join('')).toContain('canva.com');
  });

  it('exits 1 with the reason when /browser refuses', async () => {
    const err: string[] = [];
    vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => (err.push(String(chunk)), true));
    const { commands } = registryWith(() => ({ kind: 'error', message: 'the browser profile is in use by another moxxy run' }));

    expect(await runBrowserIn(commands, 'login canva.com')).toBe(1);
    expect(err.join('')).toContain('in use by another moxxy run');
  });

  it('says how to install the browser extension when it is not there', async () => {
    const err: string[] = [];
    vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => (err.push(String(chunk)), true));

    expect(await runBrowserIn(new CommandRegistry(), 'sites')).toBe(2);
    expect(err.join('')).toContain('moxxy extensions install browser');
  });
});
