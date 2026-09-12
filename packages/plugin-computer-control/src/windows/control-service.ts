import {
  computerControlCommandSchema, computerControlSnapshotSchema,
  computerApprovalFocusSchema,
  type ComputerControlService, type ComputerControlSnapshot, type ComputerControlState,
} from '@moxxy/sdk';
import type { HelperTransport } from './transport.js';

interface Entry { snapshot: ComputerControlSnapshot; transport: HelperTransport }
const key = (sessionId: string, turnId: string) => JSON.stringify([sessionId, turnId]);

/** Session-bound human controls never create a transport or replay an action. */
export class TurnControls {
  private readonly entries = new Map<string, Entry>();

  attach(sessionId: string, turnId: string, transport: HelperTransport): void {
    const id = key(sessionId, turnId);
    if (this.entries.has(id)) throw new Error('Computer Use turn already registered');
    this.entries.set(id, { transport, snapshot: computerControlSnapshotSchema.parse({
      sessionId, turnId, state: 'idle', windowId: null,
    }) });
  }

  detach(sessionId: string, turnId: string): void { this.entries.delete(key(sessionId, turnId)); }

  activity(sessionId: string, turnId: string, state: 'idle' | 'recovering', windowId?: string): void {
    const entry = this.entries.get(key(sessionId, turnId));
    if (!entry || entry.snapshot.state === 'paused_by_user' || entry.snapshot.state === 'waiting_for_focus') return;
    this.update(sessionId, turnId, state, windowId);
  }

  update(sessionId: string, turnId: string, state: ComputerControlState, windowId?: string): void {
    const entry = this.entries.get(key(sessionId, turnId));
    if (!entry || entry.snapshot.state === 'stopped' || entry.snapshot.state === 'failed') return;
    entry.snapshot = computerControlSnapshotSchema.parse({
      ...entry.snapshot, state, windowId: windowId ?? entry.snapshot.windowId,
    });
  }

  forSession(sessionId: string): ComputerControlService {
    return {
      approvalFocus: async input => {
        const command = computerApprovalFocusSchema.parse(input);
        if (command.sessionId !== sessionId) throw new Error('Computer Use session mismatch');
        const entry = this.entries.get(key(sessionId, command.turnId));
        if (!entry || entry.transport.closed || entry.snapshot.state === 'stopped') return;
        const { sessionId: _session, turnId: _turn, ...params } = command;
        await entry.transport.request('approval_focus', params, AbortSignal.timeout(3000));
      },
      snapshot: async () => [...this.entries.values()]
        .filter((entry) => entry.snapshot.sessionId === sessionId)
        .map(({ snapshot, transport }) => ({
          ...snapshot, state: transport.stoppedByUser ? 'stopped'
            : transport.closed && snapshot.state !== 'stopped' ? 'failed' : snapshot.state,
        })),
      control: async (input) => {
        const command = computerControlCommandSchema.parse(input);
        if (command.sessionId !== sessionId) throw new Error('Computer Use session mismatch');
        const entry = this.entries.get(key(sessionId, command.turnId));
        if (!entry) throw new Error('Computer Use turn is no longer active');
        if (entry.transport.closed || entry.snapshot.state === 'stopped') throw new Error('Computer Use stopped; cannot resume this turn');
        entry.transport.control(command.command);
        entry.snapshot.state = command.command === 'stop' ? 'stopped'
          : command.command === 'pause' ? 'paused_by_user' : 'recovering';
        if (command.command === 'stop') await entry.transport.close();
      },
    };
  }
}
