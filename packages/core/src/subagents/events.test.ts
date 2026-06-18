import { afterEach, describe, expect, it, vi } from 'vitest';
import { asSessionId, asTurnId, type MoxxyEvent } from '@moxxy/sdk';
import type { SessionRuntime } from '../session-runtime.js';
import type { EventLog } from '../events/log.js';
import { streamChildEventToParent } from './events.js';

const childTool: MoxxyEvent = {
  type: 'tool_call_requested',
  seq: 0,
  id: 'e0',
  ts: 0,
  sessionId: asSessionId('child'),
  turnId: asTurnId('ct'),
  source: 'model',
  callId: 'call-1',
  name: 'list_dir',
  input: { path: '.' },
} as unknown as MoxxyEvent;

describe('streamChildEventToParent', () => {
  afterEach(() => vi.restoreAllMocks());

  // u47-5: a parent-log append failure while forwarding child progress must be
  // non-fatal (the subagent run continues) AND observable (not silently lost).
  it('does not throw and surfaces a diagnostic when the parent log append rejects', async () => {
    const stderr = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
    const append = vi.fn().mockRejectedValue(new Error('disk full'));
    const parent = {
      id: asSessionId('parent'),
      log: { append } as unknown as EventLog,
    } as unknown as SessionRuntime;

    await expect(
      streamChildEventToParent(parent, asTurnId('pt'), 'researcher', asSessionId('child'), childTool),
    ).resolves.toBeUndefined();

    expect(append).toHaveBeenCalledTimes(1);
    expect(stderr).toHaveBeenCalledTimes(1);
    expect(String(stderr.mock.calls[0]![0])).toContain('disk full');
    expect(String(stderr.mock.calls[0]![0])).toContain('subagent_tool_call');
  });

  it('forwards a mapped child event to the parent log on the happy path', async () => {
    const append = vi.fn().mockResolvedValue(undefined);
    const parent = {
      id: asSessionId('parent'),
      log: { append } as unknown as EventLog,
    } as unknown as SessionRuntime;

    await streamChildEventToParent(parent, asTurnId('pt'), 'researcher', asSessionId('child'), childTool);
    expect(append).toHaveBeenCalledTimes(1);
    const arg = append.mock.calls[0]![0] as { type: string; subtype: string };
    expect(arg.type).toBe('plugin_event');
    expect(arg.subtype).toBe('subagent_tool_call');
  });
});
