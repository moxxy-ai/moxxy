import type { ApprovalRequest } from '@moxxy/sdk';
import type { DiscordApprovalResolver } from '../approval.js';
import { BUTTON_STYLE, button, packRows } from './components.js';
import type { ChannelLogger, SendableChannelLike } from './discord-like.js';

export interface ApprovalPromptDeps {
  readonly channel: SendableChannelLike | null;
  readonly resolver: DiscordApprovalResolver;
  readonly logger?: ChannelLogger;
}

/**
 * Render an approval request (e.g. plan-execute "validate plan") as a message
 * with a button per option. Options with `requestsText` are still picked here;
 * the interaction handler then captures the user's NEXT message as the
 * follow-up text via the channel's awaiting-text state.
 */
export async function askForApproval(
  id: string,
  request: ApprovalRequest,
  deps: ApprovalPromptDeps,
): Promise<void> {
  if (!deps.channel) return;
  const rows = packRows(
    request.options.map((opt) =>
      button(`appr:${id}:${opt.id}`, opt.label, BUTTON_STYLE.secondary),
    ),
  );
  // Discord caps messages at 2000 chars; keep the body well under so the
  // prompt always sends. The full plan streams in as assistant messages.
  const body = request.body.length > 1500 ? request.body.slice(0, 1499) + '…' : request.body;
  const summary =
    `📋 **${request.title}**\n\n${body}\n\n` +
    `Pick an option below. Some options (e.g. Redraft) prompt for follow-up text after you click.`;
  try {
    await deps.channel.send({ content: summary, components: rows });
  } catch (err) {
    deps.logger?.warn('discord approval send failed', { err: String(err) });
    // Default-resolve on send failure so the loop strategy doesn't hang.
    const fallback = request.defaultOptionId ?? request.options[0]?.id ?? 'cancel';
    deps.resolver.resolvePending(id, fallback);
  }
}
