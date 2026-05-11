import { describe, expect, it } from 'vitest';
import { parseFrontmatter, parseSkillFile } from './parse.js';

describe('parseSkillFile', () => {
  it('returns empty frontmatter when none present', () => {
    const { frontmatter, body } = parseSkillFile('hello world');
    expect(frontmatter).toEqual({});
    expect(body).toBe('hello world');
  });

  it('parses simple frontmatter', () => {
    const { frontmatter, body } = parseSkillFile(`---
name: foo
description: bar
---
body text`);
    expect(frontmatter).toEqual({ name: 'foo', description: 'bar' });
    expect(body.trim()).toBe('body text');
  });

  it('parses inline arrays', () => {
    const { frontmatter } = parseSkillFile(`---
name: foo
description: d
triggers: [a, b, "c d"]
---`);
    expect(frontmatter.triggers).toEqual(['a', 'b', 'c d']);
  });

  it('parses block-list arrays', () => {
    const { frontmatter } = parseSkillFile(`---
name: foo
description: d
allowed-tools:
  - Read
  - Edit
  - Bash
---`);
    expect(frontmatter['allowed-tools']).toEqual(['Read', 'Edit', 'Bash']);
  });

  it('handles quoted strings with colons', () => {
    const fm = parseFrontmatter(`description: "a: b"`);
    expect(fm.description).toBe('a: b');
  });

  it('parses numbers and booleans', () => {
    const fm = parseFrontmatter(`count: 3\nbig: true\nzero: false`);
    expect(fm.count).toBe(3);
    expect(fm.big).toBe(true);
    expect(fm.zero).toBe(false);
  });

  it('preserves multiline body with --- fence', () => {
    const md = `---\nname: foo\ndescription: d\n---\nline 1\n\nline 2`;
    const { body } = parseSkillFile(md);
    expect(body).toBe('line 1\n\nline 2');
  });
});
