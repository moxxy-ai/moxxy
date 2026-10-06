import { defineTool, z, type ToolDef } from '@moxxy/sdk';

export interface DiscordCallToolDeps {
  /** Start the call through the running bot; null when the bot does not run
   *  in this process (calls need its live gateway + voice connection). */
  readonly placeCall: (reason: string) => Promise<string> | null;
}

/**
 * `discord_call` — the agent calls the paired owner on Discord voice. The bot
 * joins the voice channel the owner is in (or rings: waits in one and DMs a
 * link) and says `reason` first; then they talk, turn by turn.
 */
export function buildDiscordCallTool(deps: DiscordCallToolDeps): ToolDef {
  return defineTool({
    name: 'discord_call',
    description:
      'Call the paired owner on Discord voice: the bot joins the voice channel they are in, or rings ' +
      '(waits in a voice channel and DMs them a link), and says `reason` out loud first; then you talk ' +
      'with them. Use it when they asked to be called, or for news or a decision worth their voice — ' +
      'for anything else prefer discord_send_message.',
    inputSchema: z.object({
      reason: z.string().min(1).max(500).describe('What you say first — why you are calling, one or two sentences.'),
    }),
    // Calling someone reaches out on their behalf — asked like any other action.
    permission: { action: 'prompt' },
    handler: async ({ reason }) => {
      const placed = deps.placeCall(reason);
      if (!placed) {
        throw new Error(
          'calls are placed by the running Discord bot — ask from its conversation (Discord, or Channels → Discord in the app)',
        );
      }
      return placed;
    },
  });
}
