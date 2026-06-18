import { describe, expect, it } from 'vitest';
import { fromYaml, toYaml } from './yaml.js';

/**
 * Branch coverage for the hand-rolled YAML codec. serialize.test.ts exercises
 * the workflow-shaped happy path + the `#`-in-block-scalar case; this pins the
 * individual emitter/parser branches the audit flagged as uncovered.
 */
describe('yaml codec — round-trip branches', () => {
  function rt(value: unknown): unknown {
    return fromYaml(toYaml(value));
  }

  it('round-trips nested sequences (arrays of arrays)', () => {
    const value = { matrix: [['a', 'b'], ['c']] };
    expect(rt(value)).toEqual(value);
  });

  it('round-trips a sequence of maps (inline-map splice)', () => {
    const value = {
      steps: [
        { id: 'first', prompt: 'do x' },
        { id: 'second', needs: ['first'] },
      ],
    };
    expect(rt(value)).toEqual(value);
  });

  it('round-trips nested maps', () => {
    const value = { on: { schedule: { cron: '0 8 * * 1-5' } } };
    expect(rt(value)).toEqual(value);
  });

  it('round-trips empty list and empty map literals', () => {
    const value = { list: [], map: {} };
    expect(rt(value)).toEqual(value);
  });

  it('round-trips scalars: numbers, booleans, null', () => {
    const value = { n: 42, f: 3.5, neg: -7, t: true, f2: false, nil: null };
    expect(rt(value)).toEqual(value);
  });

  it('quotes and round-trips number-looking and reserved-word strings', () => {
    const value = { version: '1.0', flag: 'true', maybe: 'no', port: '8080' };
    const back = rt(value) as Record<string, unknown>;
    // They must come back as the original STRINGS, not coerced types.
    expect(back).toEqual(value);
    expect(typeof back.version).toBe('string');
    expect(typeof back.flag).toBe('string');
  });

  it('quotes and round-trips strings with structural characters', () => {
    const value = { colon: 'a: b', hash: 'x # y', brace: '{not a map}', leadingDash: '- item' };
    expect(rt(value)).toEqual(value);
  });

  it('quotes and round-trips a key that needs quoting', () => {
    const value = { 'weird key:with stuff': 'v' };
    expect(rt(value)).toEqual(value);
  });

  it('emits a multiline string as a `|` (keep) block scalar', () => {
    const value = { prompt: 'line one\nline two\nline three' };
    const yaml = toYaml(value);
    expect(yaml).toMatch(/prompt: \|/);
    // The emitter uses `|` (keep), so the parsed value gains a single trailing
    // newline — the codec's documented asymmetry (see serialize.test.ts).
    expect((fromYaml(yaml) as { prompt: string }).prompt).toBe('line one\nline two\nline three\n');
  });
});

describe('yaml codec — parser-only branches (canonical host YAML)', () => {
  it('parses a flow sequence of quoted and bare scalars', () => {
    const parsed = fromYaml('needs: [a, "b", c]\n') as { needs: string[] };
    expect(parsed.needs).toEqual(['a', 'b', 'c']);
  });

  it('parses `|-` strip and `>` fold block-scalar headers', () => {
    const strip = fromYaml('p: |-\n  one\n  two\n') as { p: string };
    expect(strip.p).toBe('one\ntwo'); // strip → no trailing newline
    const fold = fromYaml('p: >\n  one\n  two\n') as { p: string };
    expect(fold.p).toBe('one two\n'); // fold → spaces, keep trailing newline
    const foldStrip = fromYaml('p: >-\n  one\n  two\n') as { p: string };
    expect(foldStrip.p).toBe('one two');
  });

  it('strips block indent by the MINIMUM body indent, preserving deeper lines (u129-5)', () => {
    // A literal block where a sub-line is indented MORE than its siblings: the
    // extra indentation is content and must survive. Anchoring on the first
    // line's indent did this; the regression risk was a line indented LESS
    // than the first (below) getting its content sliced.
    const nested = fromYaml('p: |-\n  root\n    deeper\n  back\n') as { p: string };
    expect(nested.p).toBe('root\n  deeper\nback');
  });

  it('does not slice into a body line shallower than the first (u129-5)', () => {
    // First body line indented 4, a later line indented 2. With first-line
    // anchoring, `slice(4)` would eat 2 chars of the shallower line's content
    // ("xx" -> ""). Min-indent (2) keeps both lines intact.
    const yaml = 'p: |-\n    aaaa\n  xxyy\n';
    const parsed = fromYaml(yaml) as { p: string };
    expect(parsed.p).toBe('  aaaa\nxxyy');
  });

  it('unquotes a single-quoted scalar with a doubled-quote escape', () => {
    const parsed = fromYaml("msg: 'it''s fine'\n") as { msg: string };
    expect(parsed.msg).toBe("it's fine");
  });

  it('strips a full-line comment and a trailing bare comment', () => {
    const parsed = fromYaml('# header\nname: x   # trailing note\n') as { name: string };
    expect(parsed.name).toBe('x');
  });

  it('parses a nested sequence under a dash (`-` then indented seq)', () => {
    const parsed = fromYaml('outer:\n  -\n    - a\n    - b\n') as { outer: string[][] };
    expect(parsed.outer).toEqual([['a', 'b']]);
  });
});
