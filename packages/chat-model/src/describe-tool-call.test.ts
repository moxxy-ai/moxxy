import { describe, expect, it } from 'vitest';
import { describeToolCall, formatToolActivity } from './format.js';

/**
 * `describeToolCall` exists because a tabular surface cannot use
 * `formatToolActivity`'s flat sentence: the verb repeats down every row and the
 * tool's name lands mid-string where it cannot be aligned or weighted. What is
 * pinned here is that splitting the call did not change what it SAYS — both
 * surfaces must still describe the same call the same way.
 */

describe('describeToolCall', () => {
  it('never puts a verb in the detail', () => {
    const cases: ReadonlyArray<readonly [string, unknown]> = [
      ['Read', { file_path: 'src/sse.ts' }],
      ['Grep', { pattern: 'error.type', cwd: 'packages/x' }],
      ['Bash', { command: 'pnpm test' }],
      ['Glob', { pattern: '**/*.ts' }],
      ['web_search', { query: 'agentic workflows' }],
      ['workflow_create', { intent: 'nightly digest', scope: 'user' }],
    ];
    for (const [name, input] of cases) {
      const { detail } = describeToolCall(name, input);
      expect(detail, `${name} leaked a verb`).not.toMatch(
        /^(Ran|Running|Read|Reading|Searched|Searching|Listed|Listing)\b/,
      );
      expect(detail.startsWith('·'), `${name} leaked a separator`).toBe(false);
    }
  });

  it('keeps the tool name verbatim, so the column is the real name', () => {
    expect(describeToolCall('workflow_create', {}).name).toBe('workflow_create');
    expect(describeToolCall('Grep', {}).name).toBe('Grep');
  });

  it('describes the same call as the flat formatter does', () => {
    // The detail must be a SUBSTRING of the sentence the terminal shows, so the
    // two surfaces cannot drift into describing a call differently.
    const input = { file_path: 'packages/plugin-provider-codex/src/sse.ts' };
    const { detail } = describeToolCall('Read', input);
    expect(formatToolActivity('Read', input, false)).toContain(detail);
  });

  it('quotes a grep pattern so an empty or spacey one is still visible', () => {
    expect(describeToolCall('Grep', { pattern: 'a b' }).detail).toBe('"a b"');
    expect(describeToolCall('Grep', {}).detail).toBe('"pattern"');
  });

  it('falls back to an argument summary for an unknown tool', () => {
    expect(describeToolCall('mystery', { a: 1, b: 'x' }).detail).toBe('a=1, b="x"');
    expect(describeToolCall('mystery', {}).detail).toBe('');
  });
});
