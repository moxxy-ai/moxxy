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

  it('returns {help:true} for empty argv, --help, and -h', () => {
    expect(parseFlags([])).toEqual({ help: true });
    expect(parseFlags(['--help'])).toEqual({ help: true });
    expect(parseFlags(['-h'])).toEqual({ help: true });
    // --help wins even when mixed with other (valid) flags.
    expect(parseFlags(['--prompt', 'p', '--help'])).toEqual({ help: true });
  });

  it('reports each missing required flag', () => {
    expect(() => parseFlags(['--name', 'n', '--out', 'd'])).toThrow(/--prompt is required/);
    expect(() => parseFlags(['--prompt', 'p', '--out', 'd'])).toThrow(/--name is required/);
    expect(() => parseFlags(['--prompt', 'p', '--name', 'n'])).toThrow(/--out is required/);
  });

  it('rejects an unknown flag', () => {
    expect(() =>
      parseFlags(['--prompt', 'p', '--name', 'n', '--out', 'd', '--bogus']),
    ).toThrow(/unknown flag: --bogus/);
  });

  it('trims whitespace and drops empty entries in --allow-tools', () => {
    const parsed = parseFlags([
      '--prompt', 'p', '--name', 'n', '--out', 'd',
      '--allow-tools', ' Read , , Glob ,',
    ]) as { allowTools: string[] };
    expect(parsed.allowTools).toEqual(['Read', 'Glob']);
  });

  it('defaults allowTools to [] and leaves optional fields undefined when omitted', () => {
    const parsed = parseFlags(['--prompt', 'p', '--name', 'n', '--out', 'd']) as {
      allowTools: string[];
      model?: string;
      maxIterations?: number;
      verbose: boolean;
    };
    expect(parsed.allowTools).toEqual([]);
    expect(parsed.model).toBeUndefined();
    expect(parsed.maxIterations).toBeUndefined();
    expect(parsed.verbose).toBe(false);
  });
});
