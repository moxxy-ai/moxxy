import { computerControlCommandSchema, computerControlSnapshotSchema, z, type ComputerControlService } from '@moxxy/sdk';
import { RunnerMethod } from '../protocol.js';
import type { ViewContext } from './context.js';

export function makeComputerControlView(ctx: ViewContext): ComputerControlService {
  return {
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
