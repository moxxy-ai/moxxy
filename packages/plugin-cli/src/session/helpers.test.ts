import { describe, expect, it } from 'vitest';
import type { ClientSession } from '@moxxy/sdk';
import { buildSlashSuggestions } from './helpers.js';

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
});
