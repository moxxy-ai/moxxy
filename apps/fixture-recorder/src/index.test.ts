import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FakeProvider, textReply } from '@moxxy/testing';
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

describe('fixture-recorder record() orchestration', () => {
  let tmp: string;

  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'fixture-recorder-'));
  });

  afterEach(async () => {
    await fs.rm(tmp, { recursive: true, force: true });
  });

  it('records via an injected fake upstream (no network) and returns exactly the files written this run', async () => {
    const upstream = new FakeProvider({
      name: 'anthropic-recording',
      script: [textReply('hello from fake')],
    });

    const result = await record(
      { prompt: 'say hi', name: 'demo', out: tmp, allowTools: [], verbose: false },
      { upstream },
    );

    expect(result.events).toBeGreaterThan(0);
    expect(result.fixtureFiles).toHaveLength(1);
    // Returned paths are absolute and exist on disk.
    for (const f of result.fixtureFiles) {
      expect(path.isAbsolute(f)).toBe(true);
      await expect(fs.stat(f)).resolves.toBeDefined();
    }
    // The returned set is exactly the matching files in the out dir.
    const onDisk = (await fs.readdir(tmp))
      .filter((f) => f.startsWith('demo.') && f.endsWith('.json'))
      .map((f) => path.join(tmp, f))
      .sort();
    expect(result.fixtureFiles.slice().sort()).toEqual(onDisk);
  });

  it('does NOT report stale fixtures left by a prior run with the same --name', async () => {
    // A pre-existing orphaned fixture from a different prompt/model must not leak
    // into this run's reported file set (the prefix glob alone would include it).
    const staleName = path.join(tmp, 'demo.deadbeef.json');
    await fs.writeFile(staleName, JSON.stringify({ hash: 'deadbeef', events: [] }), 'utf8');

    const upstream = new FakeProvider({
      name: 'anthropic-recording',
      script: [textReply('fresh capture')],
    });

    const result = await record(
      { prompt: 'fresh prompt', name: 'demo', out: tmp, allowTools: [], verbose: false },
      { upstream },
    );

    expect(result.fixtureFiles).toHaveLength(1);
    expect(result.fixtureFiles).not.toContain(staleName);
    expect(result.fixtureFiles[0]).not.toBe(staleName);
    // The stale file is left on disk (we never prune), but it is not reported.
    await expect(fs.stat(staleName)).resolves.toBeDefined();
  });

  it('still reports a fixture re-recorded in place (same hash) — no mtime-equality drop', async () => {
    // Re-running an identical capture overwrites the same `demo.<hash>.json` in
    // place. A directory mtime-diff could read the rewritten file as "unchanged"
    // under coarse FS mtime resolution and silently drop it from the report; the
    // recorder's own written set must report it regardless.
    const mk = () =>
      new FakeProvider({ name: 'anthropic-recording', script: [textReply('same answer')] });

    const first = await record(
      { prompt: 'identical', name: 'demo', out: tmp, allowTools: [], verbose: false },
      { upstream: mk() },
    );
    expect(first.fixtureFiles).toHaveLength(1);

    const second = await record(
      { prompt: 'identical', name: 'demo', out: tmp, allowTools: [], verbose: false },
      { upstream: mk() },
    );
    // Identical request → identical hash → same file path, rewritten in place.
    expect(second.fixtureFiles).toEqual(first.fixtureFiles);
    // And only that one file exists on disk (no duplicate, no orphan).
    const onDisk = (await fs.readdir(tmp)).filter(
      (f) => f.startsWith('demo.') && f.endsWith('.json'),
    );
    expect(onDisk).toHaveLength(1);
  });

  it('reports only absolute paths that the recorder itself wrote', async () => {
    const upstream = new FakeProvider({
      name: 'anthropic-recording',
      script: [textReply('ok')],
    });
    const result = await record(
      { prompt: 'p', name: 'demo', out: tmp, allowTools: [], verbose: false },
      { upstream },
    );
    expect(result.fixtureFiles.length).toBeGreaterThan(0);
    for (const f of result.fixtureFiles) {
      expect(path.isAbsolute(f)).toBe(true);
      expect(path.dirname(f)).toBe(tmp);
      await expect(fs.stat(f)).resolves.toBeDefined();
    }
    // Sorted, deduped.
    expect(result.fixtureFiles).toEqual([...new Set(result.fixtureFiles)].sort());
  });

  it('rejects an unknown model before touching the upstream or the out dir', async () => {
    let touched = false;
    const upstream = new FakeProvider({
      name: 'anthropic-recording',
      script: [textReply('should never run')],
      onRequest: () => {
        touched = true;
      },
    });

    await expect(
      record(
        {
          prompt: 'p',
          name: 'demo',
          out: tmp,
          model: 'claude-sonet-4-6', // typo
          allowTools: [],
          verbose: false,
        },
        { upstream },
      ),
    ).rejects.toThrow(/unknown model: claude-sonet-4-6/);
    expect(touched).toBe(false);
  });

  it('does not leak SIGINT/SIGTERM listeners after a successful record', async () => {
    const before = { int: process.listenerCount('SIGINT'), term: process.listenerCount('SIGTERM') };
    const upstream = new FakeProvider({
      name: 'anthropic-recording',
      script: [textReply('done')],
    });
    await record(
      { prompt: 'p', name: 'demo', out: tmp, allowTools: [], verbose: false },
      { upstream },
    );
    expect(process.listenerCount('SIGINT')).toBe(before.int);
    expect(process.listenerCount('SIGTERM')).toBe(before.term);
  });

  it('returns zero fixtures (no crash) when the upstream errors before any write', async () => {
    // An empty script makes the upstream error on its first call, so no fixture
    // is written. record() must still resolve with an empty file list — it
    // reports the recorder's own written set, so a never-created out dir can
    // never throw an ENOENT readdir that masks an otherwise-handled run.
    const upstream = new FakeProvider({ name: 'anthropic-recording', script: [] });
    const sub = path.join(tmp, 'nested', 'fixtures');
    const result = await record(
      { prompt: 'p', name: 'demo', out: sub, allowTools: [], verbose: false },
      { upstream },
    );
    expect(result.fixtureFiles).toEqual([]);
  });
});
