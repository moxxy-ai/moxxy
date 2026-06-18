import { describe, expect, it } from 'vitest';
import { parseFlags, record } from './index.js';

describe('fixture-recorder argv parsing', () => {
  it('importable smoke test', () => {
    // The module is mostly an orchestration script. We just verify it imports
    // cleanly and exposes `record`, so a broken entry point would fail CI.
    expect(typeof record).toBe('function');
  });

  it('parses a well-formed argv into Flags', () => {
    const parsed = parseFlags([
      '--prompt', 'list files',
      '--name', 'demo',
      '--out', 'fixtures',
      '--model', 'claude-sonnet-4-6',
      '--allow-tools', 'Read,Glob',
      '--max-iterations', '4',
      '--verbose',
    ]);
    expect(parsed).toEqual({
      prompt: 'list files',
      name: 'demo',
      out: 'fixtures',
      model: 'claude-sonnet-4-6',
      allowTools: ['Read', 'Glob'],
      maxIterations: 4,
      verbose: true,
    });
  });

  it('rejects a value-bearing flag whose value is itself a flag', () => {
    // `--prompt --name x` must not swallow `--name` as the prompt value; it
    // should report a clear "requires a value" error.
    expect(() => parseFlags(['--prompt', '--name', 'x', '--out', 'd'])).toThrow(
      /--prompt requires a value/,
    );
  });

  it('rejects a trailing value-bearing flag with no value', () => {
    expect(() => parseFlags(['--name', 'n', '--out', 'd', '--prompt'])).toThrow(
      /--prompt requires a value/,
    );
  });

  it('rejects a non-numeric --max-iterations instead of silently dropping it', () => {
    // `Number('abc')` is NaN, which is falsy — without validation the cap would
    // be silently ignored and the recorder would run unbounded.
    expect(() =>
      parseFlags(['--prompt', 'p', '--name', 'n', '--out', 'd', '--max-iterations', 'abc']),
    ).toThrow(/--max-iterations must be a positive integer/);
  });

  it('rejects a non-positive --max-iterations', () => {
    expect(() =>
      parseFlags(['--prompt', 'p', '--name', 'n', '--out', 'd', '--max-iterations', '0']),
    ).toThrow(/--max-iterations must be a positive integer/);
  });
});
