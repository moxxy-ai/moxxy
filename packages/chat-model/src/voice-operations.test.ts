import { describe, expect, it } from 'vitest';
import { categorizeVoiceOperation } from './voice-operations.js';

describe('categorizeVoiceOperation', () => {
  it.each([
    ['web_search', 'web-search'],
    ['web_fetch', 'web-search'],
    ['web.run', 'web-search'],
    ['Read', 'project-read'],
    ['Grep', 'project-read'],
    ['Glob', 'project-read'],
    ['apply_patch', 'editing'],
    ['Write', 'editing'],
    ['run_focused_tests', 'verification'],
    ['typecheck', 'verification'],
    ['Bash', 'command'],
    ['computer_use', 'application'],
    ['dispatch_agent', 'delegation'],
    ['something_private', 'generic'],
  ] as const)('maps %s to the safe %s category', (toolName, expected) => {
    expect(categorizeVoiceOperation(toolName)).toBe(expected);
  });

  it('never needs tool input to produce a user-facing category', () => {
    expect(categorizeVoiceOperation('Bash')).toBe('command');
    expect(categorizeVoiceOperation('/private/path token=secret')).toBe('generic');
  });

  it('recognizes verification commands without returning their contents', () => {
    expect(categorizeVoiceOperation('Bash', { command: 'pnpm test -- private-suite' }))
      .toBe('verification');
  });

  it('distinguishes read-only project inspection from a general command', () => {
    expect(categorizeVoiceOperation('exec_command', { command: 'rg -n secret src' }))
      .toBe('project-read');
  });
});
