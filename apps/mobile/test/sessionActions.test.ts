import { describe, expect, it } from 'vitest';
import {
  actionMatchesFilter,
  buildMobileSessionActionRows,
  encodeSessionCommandArgs,
  subcommandForSessionAction,
} from '../src/sessionActions';
import { normalizeSessionCommandResult } from '../src/sessionCommandResult';

describe('buildMobileSessionActionRows', () => {
  it('surfaces the desktop-equivalent session actions with destructive actions separated', () => {
    expect(buildMobileSessionActionRows().map((row) => [row.id, row.name, row.tone])).toEqual([
      ['info', 'info', 'neutral'],
      ['clear', 'clear', 'destructive'],
      ['new', 'new', 'neutral'],
      ['compact', 'compact', 'attention'],
      ['help', 'help', 'neutral'],
    ]);
  });

  it('keeps runtime-provided commands while enriching known actions', () => {
    const rows = buildMobileSessionActionRows([
      { name: 'collab_say', description: 'Send a message into the active collaboration.' },
      { name: 'vault', description: 'Store a secret or list stored names' },
      { name: 'clear', description: 'Runtime clear description' },
    ]);

    expect(rows.map((row) => row.name)).toEqual(['collab_say', 'vault', 'clear']);
    expect(rows[0]?.label).toBe('Collab_say');
    expect(rows[1]?.args.map((arg) => arg.id)).toEqual(['key', 'value']);
    expect(rows[2]?.description).toBe('Clear the chat scrollback while keeping the session log replayable.');
  });

  it('filters by name, label, description and aliases', () => {
    const [row] = buildMobileSessionActionRows([
      { name: 'info', description: 'Show provider details', aliases: ['status'] },
    ]);

    expect(row ? actionMatchesFilter(row, 'provider') : false).toBe(true);
    expect(row ? actionMatchesFilter(row, 'status') : false).toBe(true);
    expect(row ? actionMatchesFilter(row, 'missing') : true).toBe(false);
  });
});

describe('encodeSessionCommandArgs', () => {
  it('quotes command arguments the same way for mobile action forms', () => {
    expect(encodeSessionCommandArgs(['alpha beta', 'plain', 'needs"quote'])).toBe(
      '"alpha beta" plain "needs\\"quote"',
    );
  });

  it('prepends known action subcommands for argument forms', () => {
    expect(subcommandForSessionAction('vault')).toBe('set');
    expect(subcommandForSessionAction('info')).toBeUndefined();
  });
});

describe('normalizeSessionCommandResult', () => {
  it('turns text command output into an action result block', () => {
    expect(normalizeSessionCommandResult('info', '', { kind: 'text', text: 'ready' })).toEqual({
      sideEffect: null,
      dispatch: {
        type: 'action_result',
        commandName: 'info',
        argsLine: '',
        tone: 'info',
        text: 'ready',
      },
    });
  });

  it('keeps clear and new as side effects without rendering empty noise', () => {
    expect(normalizeSessionCommandResult('clear', '', { kind: 'session-action', action: 'clear' })).toEqual({
      sideEffect: 'clear',
      dispatch: null,
    });
  });
});
