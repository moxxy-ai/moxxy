import { computerApprovalFocusSchema, computerControlCommandSchema, computerControlSnapshotSchema, z, type ComputerControlService, type ComputerControlSnapshot } from '@moxxy/sdk';
import { RunnerMethod, RunnerNotification } from '../protocol.js';
import type { ViewContext } from './context.js';

const turnsSchema = z.object({ turns: z.array(computerControlSnapshotSchema).max(256) });

export function makeComputerControlView(ctx: ViewContext): ComputerControlService {
  const listeners = new Set<(turns: ReadonlyArray<ComputerControlSnapshot>) => void>();
  ctx.peer.on(RunnerNotification.ComputerChanged, (params) => {
    const parsed = turnsSchema.safeParse(params);
    // A malformed push is dropped; the next change or a snapshot read restores the view.
    if (!parsed.success) return;
    for (const listener of listeners) listener(parsed.data.turns);
  });
  return {
    subscribe: (listener) => {
      ctx.requireServerProtocol(23, 'Live Computer Use status');
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    approvalFocus: async input => {
      ctx.requireServerProtocol(13, 'Computer Use approval focus');
      const command = computerApprovalFocusSchema.parse(input);
      if (command.sessionId !== ctx.requireInfo().sessionId) throw new Error('Computer Use session mismatch');
      await ctx.peer.request(RunnerMethod.ComputerApprovalFocus, command);
    },
    snapshot: async () => {
      ctx.requireServerProtocol(12, 'Reading Computer Use control');
      return z.array(computerControlSnapshotSchema).max(256).parse(await ctx.peer.request(RunnerMethod.ComputerSnapshot, {}));
    },
    control: async (input) => {
      ctx.requireServerProtocol(12, 'Controlling Computer Use');
      const command = computerControlCommandSchema.parse(input);
      if (command.sessionId !== ctx.requireInfo().sessionId) throw new Error('Computer Use session mismatch');
      await ctx.peer.request(RunnerMethod.ComputerControl, command);
    },
  };
}
