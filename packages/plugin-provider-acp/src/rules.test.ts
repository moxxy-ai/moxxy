/** OpenCode's permission rules as `opencode debug agent <name>` reports them, read and turned into asks. */
import { describe, expect, it } from 'vitest';
import { askingConfig, askingRules, asksOutsideProject, openCodeOwnAutoApprove, runsWithoutAsking, type OpenCodeRule } from './rules.js';

const rule = (permission: string, pattern: string, action: OpenCodeRule['action']): OpenCodeRule => ({ permission, pattern, action });

/** OpenCode 1.18's defaults for the build agent, abridged. */
const DEFAULTS: OpenCodeRule[] = [
  rule('*', '*', 'allow'),
  rule('doom_loop', '*', 'ask'),
  rule('external_directory', '*', 'ask'),
  rule('read', '*', 'allow'),
  rule('read', '*.env', 'ask'),
];

describe('reading how OpenCode runs', () => {
  it('runs without asking on its defaults', () => {
    expect(runsWithoutAsking(DEFAULTS)).toBe(true);
  });

  it('asks when the person set it to ask before edits or commands', () => {
    expect(runsWithoutAsking([...DEFAULTS, rule('edit', '*', 'ask')])).toBe(false);
    expect(runsWithoutAsking([...DEFAULTS, rule('bash', '*', 'ask')])).toBe(false);
  });

  it('counts only the rule for any input, not one for a single command', () => {
    expect(runsWithoutAsking([...DEFAULTS, rule('bash', 'git push *', 'ask')])).toBe(true);
  });
});

describe('the rules that make OpenCode ask', () => {
  it('turns what OpenCode allows into asks, before edits, commands and web requests', () => {
    expect(askingRules(DEFAULTS)).toEqual({ edit: { '*': 'ask' }, bash: { '*': 'ask' }, webfetch: 'ask', websearch: 'ask' });
  });

  it('keeps what the person denied or set to ask, in their order', () => {
    const rules = [...DEFAULTS, rule('bash', '*', 'allow'), rule('bash', 'git push *', 'deny'), rule('bash', 'git status', 'allow'), rule('webfetch', '*', 'deny')];

    expect(askingRules(rules)).toEqual({
      edit: { '*': 'ask' },
      bash: { '*': 'ask', 'git push *': 'deny', 'git status': 'ask' },
      webfetch: 'deny',
      websearch: 'ask',
    });
    expect(Object.keys((askingRules(rules) as { bash: object }).bash)).toEqual(['*', 'git push *', 'git status']);
  });

  it('keeps a later rule for the same pattern, in its later place', () => {
    const rules = [...DEFAULTS, rule('bash', 'rm *', 'deny'), rule('bash', 'ls', 'allow'), rule('bash', 'rm *', 'allow')];

    expect(Object.entries((askingRules(rules) as { bash: object }).bash)).toEqual([
      ['*', 'ask'],
      ['ls', 'ask'],
      ['rm *', 'ask'],
    ]);
  });

  it('leaves edits denied where the agent denies them (OpenCode plan)', () => {
    expect((askingRules([...DEFAULTS, rule('edit', '*', 'deny')]) as { edit: unknown }).edit).toEqual({ '*': 'deny' });
  });

  it('hands them to the agent the person runs, for this OpenCode only', () => {
    expect(JSON.parse(askingConfig('build', DEFAULTS))).toEqual({ agent: { build: { permission: askingRules(DEFAULTS) } } });
  });

  it('keeps the inline config the person already passes OpenCode', () => {
    const inline = JSON.stringify({ model: 'openai/gpt-6-luna', agent: { build: { temperature: 0.2, permission: { bash: 'allow' } }, review: { mode: 'subagent' } } });

    expect(JSON.parse(askingConfig('build', DEFAULTS, inline))).toEqual({
      model: 'openai/gpt-6-luna',
      agent: { build: { temperature: 0.2, permission: askingRules(DEFAULTS) }, review: { mode: 'subagent' } },
    });
  });
});

describe('asks about work outside the project', () => {
  it('knows them by the folder a file or a command names', () => {
    expect(asksOutsideProject({ filepath: '/elsewhere/a.txt', parentDir: '/elsewhere' })).toBe(true);
    expect(asksOutsideProject({ command: 'ls /elsewhere', directories: ['/elsewhere'], patterns: ['/elsewhere/*'] })).toBe(true);
  });

  it('leaves every other ask alone', () => {
    expect(asksOutsideProject({ filepath: '/work/app/a.txt', diff: '+x' })).toBe(false);
    expect(asksOutsideProject({ command: 'git push' })).toBe(false);
    expect(asksOutsideProject(undefined)).toBe(false);
  });
});

describe("the auto-approve of the person's own OpenCode", () => {
  it("is read from the build agent's rules in the conversation folder: on when they ask for nothing", async () => {
    const read: Array<{ cwd: string; agent: string }> = [];
    const own = (rules: OpenCodeRule[] | undefined) =>
      openCodeOwnAutoApprove('/work/app', async (opts) => {
        read.push(opts);
        return rules;
      });

    expect(await own(DEFAULTS)).toBe(true);
    expect(await own([...DEFAULTS, rule('edit', '*', 'ask')])).toBe(false);
    expect(await own(undefined)).toBeUndefined();
    expect(read[0]).toEqual({ cwd: '/work/app', agent: 'build' });
  });

  it('is unknown when OpenCode cannot be asked', async () => {
    expect(await openCodeOwnAutoApprove('/work/app', async () => Promise.reject(new Error('spawn opencode ENOENT')))).toBeUndefined();
  });
});
