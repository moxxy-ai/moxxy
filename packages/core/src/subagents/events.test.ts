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

  // A child Bash/Read returning a multi-MB blob must NOT be copied verbatim into
  // the parent log (unbounded amplification): the forwarded output is truncated.
  it('truncates an oversized child tool_result output before mirroring to the parent', async () => {
    const append = vi.fn().mockResolvedValue(undefined);
    const parent = {
      id: asSessionId('parent'),
      log: { append } as unknown as EventLog,
    } as unknown as SessionRuntime;

    const huge = 'x'.repeat(2 * 1024 * 1024); // 2 MiB
    const bigResult = {
      type: 'tool_result',
      seq: 1,
      id: 'e1',
      ts: 0,
      sessionId: asSessionId('child'),
      turnId: asTurnId('ct'),
      source: 'model',
      callId: 'call-2',
      ok: true,
      output: huge,
    } as unknown as MoxxyEvent;

    await streamChildEventToParent(parent, asTurnId('pt'), 'researcher', asSessionId('child'), bigResult);
    expect(append).toHaveBeenCalledTimes(1);
    const arg = append.mock.calls[0]![0] as { payload: { output: string } };
    expect(arg.payload.output.length).toBeLessThan(huge.length);
    expect(arg.payload.output.length).toBeLessThan(64 * 1024);
    expect(arg.payload.output).toContain('elided');
  });

  it('passes a small child tool_result output through unchanged', async () => {
    const append = vi.fn().mockResolvedValue(undefined);
    const parent = {
      id: asSessionId('parent'),
      log: { append } as unknown as EventLog,
    } as unknown as SessionRuntime;

    const smallResult = {
      type: 'tool_result',
      seq: 1,
      id: 'e1',
      ts: 0,
      sessionId: asSessionId('child'),
      turnId: asTurnId('ct'),
      source: 'model',
      callId: 'call-3',
      ok: true,
      output: 'short output',
    } as unknown as MoxxyEvent;

    await streamChildEventToParent(parent, asTurnId('pt'), 'researcher', asSessionId('child'), smallResult);
    const arg = append.mock.calls[0]![0] as { payload: { output: unknown } };
    expect(arg.payload.output).toBe('short output');
  });
});
