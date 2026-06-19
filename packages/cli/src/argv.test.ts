import { describe, expect, it } from 'vitest';
import { parseArgv } from './argv.js';

describe('parseArgv', () => {
  it('empty argv → tui command', () => {
    expect(parseArgv([])).toMatchObject({ command: 'tui' });
  });

  it('-p alone maps to prompt command', () => {
    expect(parseArgv(['-p', 'hello'])).toMatchObject({
      command: 'prompt',
      flags: { p: 'hello' },
    });
  });

  it('--prompt maps to prompt command', () => {
    expect(parseArgv(['--prompt', 'hello'])).toMatchObject({
      command: 'prompt',
      flags: { prompt: 'hello' },
    });
  });

  it('explicit tui command', () => {
    expect(parseArgv(['tui'])).toMatchObject({ command: 'tui' });
  });

  it('skills new <name>', () => {
    expect(parseArgv(['skills', 'new', 'foo'])).toMatchObject({
      command: 'skills',
      positional: ['new', 'foo'],
    });
  });

  it('--key=value form', () => {
    expect(parseArgv(['-p', 'x', '--output-format=json'])).toMatchObject({
      flags: { 'output-format': 'json' },
    });
  });

  it('--flag without value is true', () => {
    expect(parseArgv(['-p', 'x', '--allow-all'])).toMatchObject({
      flags: { 'allow-all': true },
    });
  });

  it('--version maps to version command', () => {
    expect(parseArgv(['--version'])).toMatchObject({ command: 'version' });
  });

  it('boolean flag does not swallow the following positional', () => {
    // `--allow-all` is value-less, so `bash` stays a positional (not consumed
    // as the flag's value). Command stays tui since argv led with a flag.
    expect(parseArgv(['--allow-all', 'bash'])).toMatchObject({
      command: 'tui',
      flags: { 'allow-all': true },
      positional: ['bash'],
    });
  });

  it('boolean flag mid-args leaves later positionals intact', () => {
    expect(parseArgv(['plugins', '--reload', 'install'])).toMatchObject({
      command: 'plugins',
      flags: { reload: true },
      positional: ['install'],
    });
  });

  it('value flags still consume their argument', () => {
    expect(parseArgv(['tui', '--model', 'gpt-5'])).toMatchObject({
      command: 'tui',
      flags: { model: 'gpt-5' },
      positional: [],
    });
  });

  it('a value flag consumes a dash-leading value instead of dropping it', () => {
    // `-p "-please summarize"` must keep the prompt, not parse `p` as boolean
    // and lose the dash-leading text.
    expect(parseArgv(['-p', '-please summarize'])).toMatchObject({
      command: 'prompt',
      flags: { p: '-please summarize' },
      positional: [],
    });
    expect(parseArgv(['tui', '--model', '-o-weird-id'])).toMatchObject({
      command: 'tui',
      flags: { model: '-o-weird-id' },
    });
  });

  it('a trailing value flag with nothing after it stays boolean (no crash)', () => {
    expect(parseArgv(['tui', '--model'])).toMatchObject({
      command: 'tui',
      flags: { model: true },
    });
  });

  it('`--` ends option parsing; the remainder is verbatim positionals', () => {
    expect(parseArgv(['prompt', '--', '--not-a-flag', '-x'])).toMatchObject({
      command: 'prompt',
      positional: ['--not-a-flag', '-x'],
    });
  });
});
