import { describe, expect, it } from 'vitest';
import type { ClientSession } from '@moxxy/sdk';
import { buildSlashSuggestions, nextSelectableMode } from './helpers.js';

describe('buildSlashSuggestions', () => {
  const session = {
    commands: {
      listForChannel: () => [
        { name: 'new', description: 'Start a fresh run' },
        { name: 'help', description: 'Show help' },
        { name: 'exit', description: 'Leave moxxy' },
      ],
    },
  } as unknown as ClientSession;

  it('keeps the bare slash menu capability-aware', () => {
    const attached = buildSlashSuggestions(session, {
      canSwitchRuns: false,
      canManageExtensions: false,
    });
    expect(attached.map((command) => command.name)).not.toContain('runs');
    expect(attached.map((command) => command.name)).not.toContain('extensions');
    expect(attached.map((command) => command.name)).not.toContain('collab');

    const local = buildSlashSuggestions(session, {
      canSwitchRuns: true,
      canManageExtensions: true,
    });
    expect(local.map((command) => command.name).slice(0, 6)).toEqual([
      'new',
      'runs',
      'model',
      'extensions',
      'help',
      'exit',
    ]);
  });

  it('keeps collaboration behind one TUI entry point', () => {
    const collabSession = {
      commands: {
        listForChannel: () => [
          { name: 'collab_say', description: 'Message an agent' },
          { name: 'collab_direct', description: 'Direct the team' },
          { name: 'collab_pause', description: 'Pause the team' },
          { name: 'collab_resume', description: 'Resume the team' },
        ],
      },
    } as unknown as ClientSession;

    const suggestions = buildSlashSuggestions(collabSession, {
      canSwitchRuns: true,
      canManageExtensions: true,
    });
    const names = suggestions.map((command) => command.name);
    expect(names.filter((name) => name === 'collab')).toHaveLength(1);
    expect(names.filter((name) => name.startsWith('collab_'))).toEqual([]);
  });
});

describe('nextSelectableMode', () => {
  it('cycles only registered modes and skips special modes', () => {
    const modes = [
      { name: 'default' },
      { name: 'collaborative', special: { invokedBy: 'collab' } },
      { name: 'research' },
    ];
    const session = {
      modes: {
        list: () => modes,
        getActive: () => modes[0],
      },
    } as unknown as ClientSession;

    expect(nextSelectableMode(session)?.name).toBe('research');
  });

  it('returns null when there is nothing to cycle', () => {
    const only = { name: 'default' };
    const session = {
      modes: { list: () => [only], getActive: () => only },
    } as unknown as ClientSession;
    expect(nextSelectableMode(session)).toBeNull();
  });
});
