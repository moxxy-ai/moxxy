import { describe, expect, it } from 'vitest';
import type { ClientSession } from '@moxxy/sdk';
import { buildSlashSuggestions, nextSelectableMode, resolveActiveModel } from './helpers.js';

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

  it('offers no /collab command, since collaborative mode was removed', () => {
    const suggestions = buildSlashSuggestions(session, {
      canSwitchRuns: true,
      canManageExtensions: true,
    });
    expect(suggestions.map((command) => command.name)).not.toContain('collab');
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

describe('resolveActiveModel', () => {
  const info = { defaultModel: 'light' };

  it('shows the model the runner runs a turn on while none is picked', () => {
    expect(resolveActiveModel(info, null, undefined)).toBe('light');
    expect(resolveActiveModel({}, null, undefined)).toBe('default');
  });

  it('shows a picked model first', () => {
    expect(resolveActiveModel(info, 'picked', 'prop')).toBe('picked');
    expect(resolveActiveModel(info, null, 'prop')).toBe('prop');
  });
});
