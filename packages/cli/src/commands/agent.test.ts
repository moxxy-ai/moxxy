import { describe, expect, it } from 'vitest';
import { buildSeedTurn } from './agent.js';

describe('buildSeedTurn', () => {
  it('frames an implementer with the overall goal, its sub-task, and the brief pointer', () => {
    const turn = buildSeedTurn({
      role: 'implementer',
      parentTask: 'Build a documentation site',
      subtask: 'Write the API reference page',
    });
    expect(turn).toContain('Overall team goal: Build a documentation site');
    expect(turn).toContain('Your sub-task: Write the API reference page');
    expect(turn).toContain('.moxxy-collab/BRIEF.md');
    expect(turn).toContain('.moxxy-collab/CONTRACTS.md');
  });

  it('does not duplicate the goal for the architect (whose sub-task IS the goal)', () => {
    const turn = buildSeedTurn({
      role: 'architect',
      parentTask: 'Build a documentation site',
      subtask: 'Build a documentation site',
    });
    expect(turn).not.toContain('Overall team goal:');
    expect(turn).toContain('Build a documentation site');
    expect(turn).toContain('.moxxy-collab/BRIEF.md');
  });

  it('leads with the agent\'s role when it is a named function (not generic implementer)', () => {
    const writer = buildSeedTurn({ role: 'writer', parentTask: 'Write the launch blog', subtask: 'Draft the intro section' });
    expect(writer).toContain('Your role on the team: writer.');
    const impl = buildSeedTurn({ role: 'implementer', parentTask: 'Build X', subtask: 'the API' });
    expect(impl).not.toContain('Your role on the team:');
  });

  it('falls back to just the pointer when there is no sub-task text', () => {
    const turn = buildSeedTurn({ role: 'implementer', parentTask: '', subtask: '' });
    expect(turn).toContain('.moxxy-collab/BRIEF.md');
    expect(turn).not.toContain('Your sub-task:');
  });
});
