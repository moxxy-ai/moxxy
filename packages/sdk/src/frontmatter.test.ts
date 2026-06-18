import { describe, expect, it } from 'vitest';
import { parseFrontmatter, parseFrontmatterFile, renderFrontmatter } from './frontmatter.js';

// Golden tests for the canonical frontmatter parser. This module replaced two
// previously-copy-pasted copies (packages/core/src/skills/parse.ts and
// packages/plugin-memory/src/parse.ts). The cases below pin the EXACT prior
// behavior of the more-correct `core` copy: parse output fields, missing/blank
// frontmatter handling, body offset, and the inline-array/scalar typing where
// the two copies had diverged.
describe('parseFrontmatterFile', () => {
  it('returns empty frontmatter and original body when no fence present', () => {
    const { frontmatter, body } = parseFrontmatterFile('hello world');
    expect(frontmatter).toEqual({});
    expect(body).toBe('hello world');
  });

  it('returns the original content unchanged when the closing fence is missing', () => {
    const input = '---\nname: foo\nbody but no close';
    const { frontmatter, body } = parseFrontmatterFile(input);
    expect(frontmatter).toEqual({});
    expect(body).toBe(input);
  });

  it('parses simple frontmatter and offsets the body past the closing fence', () => {
    const { frontmatter, body } = parseFrontmatterFile(`---
name: foo
description: bar
---
body text`);
    expect(frontmatter).toEqual({ name: 'foo', description: 'bar' });
    expect(body).toBe('body text');
  });

  it('preserves a multiline body verbatim after the --- fence', () => {
    const md = `---\nname: foo\ndescription: d\n---\nline 1\n\nline 2`;
    const { body } = parseFrontmatterFile(md);
    expect(body).toBe('line 1\n\nline 2');
  });

  it('treats an empty body after the fence as an empty string', () => {
    const { frontmatter, body } = parseFrontmatterFile(`---\nname: foo\n---`);
    expect(frontmatter).toEqual({ name: 'foo' });
    expect(body).toBe('');
  });

  it('handles CRLF opening + closing fences', () => {
    const { frontmatter, body } = parseFrontmatterFile('---\r\nname: foo\r\n---\r\nbody');
    expect(frontmatter).toEqual({ name: 'foo' });
    expect(body).toBe('body');
  });

  it('does not treat a leading "---" without a newline as a fence', () => {
    const { frontmatter, body } = parseFrontmatterFile('---not a fence');
    expect(frontmatter).toEqual({});
    expect(body).toBe('---not a fence');
  });
});

describe('parseFrontmatter', () => {
  it('parses inline arrays with quoted commas (canonical splitArray behavior)', () => {
    const fm = parseFrontmatter('triggers: [a, b, "c d"]');
    expect(fm.triggers).toEqual(['a', 'b', 'c d']);
  });

  it('keeps a quoted comma inside one inline-array element (divergence fix)', () => {
    // The diverged plugin-memory copy split on bare commas; the canonical
    // (core) copy must keep "a, b" as a single element.
    const fm = parseFrontmatter('tags: ["a, b", c]');
    expect(fm.tags).toEqual(['a, b', 'c']);
  });

  it('parses nested inline arrays', () => {
    const fm = parseFrontmatter('matrix: [[1, 2], [3, 4]]');
    expect(fm.matrix).toEqual([
      [1, 2],
      [3, 4],
    ]);
  });

  it('parses empty inline arrays', () => {
    expect(parseFrontmatter('items: []').items).toEqual([]);
  });

  it('parses block-list arrays', () => {
    const fm = parseFrontmatter('allowed-tools:\n  - Read\n  - Edit\n  - Bash');
    expect(fm['allowed-tools']).toEqual(['Read', 'Edit', 'Bash']);
  });

  it('parses numbers, floats, booleans, and null', () => {
    const fm = parseFrontmatter('count: 3\nratio: 1.5\nbig: true\nzero: false\nempty: null\ntwiddle: ~');
    expect(fm.count).toBe(3);
    expect(fm.ratio).toBe(1.5);
    expect(fm.big).toBe(true);
    expect(fm.zero).toBe(false);
    expect(fm.empty).toBeNull();
    expect(fm.twiddle).toBeNull();
  });

  it('strips quotes and tolerates colons inside quoted values', () => {
    const fm = parseFrontmatter('description: "a: b"');
    expect(fm.description).toBe('a: b');
  });

  it('skips blank lines, comments, and lines without a colon', () => {
    const fm = parseFrontmatter('# a comment\n\nname: foo\nnocolon\ndescription: bar');
    expect(fm).toEqual({ name: 'foo', description: 'bar' });
  });

  it('returns an empty object for blank frontmatter text', () => {
    expect(parseFrontmatter('')).toEqual({});
    expect(parseFrontmatter('   \n   ')).toEqual({});
  });
});

describe('renderFrontmatter', () => {
  it('renders scalars, arrays, and quotes values that need it', () => {
    const rendered = renderFrontmatter({
      name: 'foo',
      tags: ['a', 'b'],
      desc: 'a: b',
      count: 3,
    });
    expect(rendered).toBe('---\nname: foo\ntags: [a, b]\ndesc: "a: b"\ncount: 3\n---');
  });

  it('skips null and undefined values', () => {
    const rendered = renderFrontmatter({ name: 'foo', gone: null, missing: undefined });
    expect(rendered).toBe('---\nname: foo\n---');
  });

  it('round-trips a representative document through render -> parse', () => {
    const fm = { name: 'foo', description: 'a thing', tags: ['x', 'y'] };
    const doc = `${renderFrontmatter(fm)}\n\nbody content\n`;
    const parsed = parseFrontmatterFile(doc);
    expect(parsed.frontmatter).toEqual(fm);
    // The closing fence regex consumes `\n---\n`, so the blank line authored
    // between the fence and the body survives in the body offset (unchanged
    // historical behavior).
    expect(parsed.body).toBe('\nbody content\n');
  });
});
