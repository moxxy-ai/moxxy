import {
  computerControlCommandSchema, computerControlSnapshotSchema, computerCursorSchema, computerTargetSchema,
  computerApprovalFocusSchema,
  type ComputerControlService, type ComputerControlSnapshot, type ComputerControlState, type ComputerCursor, type ComputerTarget,
} from '@moxxy/sdk';
import type { HelperTransport } from '../helper/transport.js';

interface Entry { snapshot: ComputerControlSnapshot; transport: HelperTransport }
const key = (sessionId: string, turnId: string) => JSON.stringify([sessionId, turnId]);
const ended = (state: ComputerControlState) => state === 'stopped' || state === 'failed';

/** A stopped or dead helper shows no cursor, whatever it reported last. */
function withoutCursor({ cursor: _cursor, ...rest }: ComputerControlSnapshot): ComputerControlSnapshot { return rest; }

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
    if (!entry || ended(entry.snapshot.state)) return;
    entry.snapshot = computerControlSnapshotSchema.parse({
      ...entry.snapshot, state, windowId: windowId ?? entry.snapshot.windowId,
    });
  }

  /** `null` hides the cursor; a helper that already stopped cannot bring it back. */
  cursor(sessionId: string, turnId: string, cursor: ComputerCursor | null): void {
    const next = cursor === null ? null : computerCursorSchema.parse(cursor);
    const entry = this.entries.get(key(sessionId, turnId));
    if (!entry) return;
    entry.snapshot = next === null || ended(entry.snapshot.state) || entry.transport.closed
      ? withoutCursor(entry.snapshot) : { ...entry.snapshot, cursor: next };
  }

  target(sessionId: string, turnId: string, target: ComputerTarget): void {
    const entry = this.entries.get(key(sessionId, turnId));
    if (!entry) return;
    entry.snapshot = { ...entry.snapshot, target: computerTargetSchema.parse({ app: target.app.slice(0, 160), window: target.window?.slice(0, 200) ?? null }) };
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
        .map(({ snapshot, transport }) => {
          const state = transport.stoppedByUser ? 'stopped'
            : transport.closed && snapshot.state !== 'stopped' ? 'failed' : snapshot.state;
          return ended(state) ? { ...withoutCursor(snapshot), state } : { ...snapshot, state };
        }),
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
