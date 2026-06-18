import type { CommandDef, CommandInfo, CommandsClientView } from '@moxxy/sdk';
import { RunnerMethod } from '../protocol.js';
import type { ViewContext } from './context.js';

export function makeCommandsView(ctx: ViewContext): CommandsClientView {
  const { peer, requireInfo } = ctx;
  const build = (info: CommandInfo): CommandDef => ({
    name: info.name,
    description: info.description,
    ...(info.aliases ? { aliases: info.aliases } : {}),
    ...(info.channels ? { channels: info.channels } : {}),
    ...(info.pendingNotice ? { pendingNotice: info.pendingNotice } : {}),
    // Execute the real command on the runner and apply its result locally.
    handler: (cmdCtx) =>
      peer.request(RunnerMethod.CommandRun, {
        name: info.name,
        args: cmdCtx.args,
        channel: cmdCtx.channel,
      }),
  });
  return {
    get: (name) => {
      const info = requireInfo().commands.find(
        (c) => c.name === name || c.aliases?.includes(name),
      );
      return info ? build(info) : undefined;
    },
    listForChannel: (channel) =>
      requireInfo()
        .commands.filter((c) => !c.channels || c.channels.includes(channel))
        .map(build),
  };
}
