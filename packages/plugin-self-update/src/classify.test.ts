import { describe, expect, it } from 'vitest';
import { classify, suggestName, type ClassifySignals } from './classify.js';

const empty: ClassifySignals = { failedTools: [], errorMessages: [], registeredTools: [] };

describe('classify', () => {
  it('escalates to core when the error mentions core internals', () => {
    const r = classify(
      { trigger: 'error' },
      { ...empty, errorMessages: ['TypeError in packages/core/src/run-turn.ts'] },
    );
    expect(r.tier).toBe('core');
  });

  it('recommends a plugin when a called tool is not registered', () => {
    const r = classify(
      { trigger: 'error' },
      { failedTools: ['fetch_weather'], errorMessages: ['no tool'], registeredTools: ['Read', 'Bash'] },
    );
    expect(r.tier).toBe('plugin');
    expect(r.candidateName).toBeDefined();
  });

  it('recommends a skill when an existing tool was misused', () => {
    const r = classify(
      { trigger: 'error', text: 'it keeps using the wrong path' },
      { failedTools: ['Read'], errorMessages: ['ENOENT'], registeredTools: ['Read'] },
    );
    expect(r.tier).toBe('skill');
  });

  it('recommends a plugin to wrap an existing misbehaving tool when override is implied', () => {
    const r = classify(
      { trigger: 'request', text: 'wrap the Read tool to truncate huge files' },
      { failedTools: ['Read'], errorMessages: [], registeredTools: ['Read'] },
    );
    expect(r.tier).toBe('plugin');
  });

  it('treats a procedure request as a skill', () => {
    const r = classify(
      { trigger: 'request', text: 'always run the linter before committing' },
      empty,
    );
    expect(r.tier).toBe('skill');
  });

  it('treats a new-capability request as a plugin', () => {
    const r = classify(
      { trigger: 'request', text: 'add a tool that calls the GitHub API' },
      empty,
    );
    expect(r.tier).toBe('plugin');
  });

  it('defaults ambiguous requests to the plugin tier', () => {
    const r = classify({ trigger: 'request', text: 'do the thing' }, empty);
    expect(r.tier).toBe('plugin');
  });
});

describe('suggestName', () => {
  it('builds a kebab slug, dropping stop words', () => {
    expect(suggestName('add a tool that calls the GitHub API')).toBe('tool-calls-github-api');
  });
  it('returns undefined for empty input', () => {
    expect(suggestName(undefined)).toBeUndefined();
  });
});
