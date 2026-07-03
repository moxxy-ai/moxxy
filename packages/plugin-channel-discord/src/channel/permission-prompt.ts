import type { PendingToolCall, PermissionContext } from '@moxxy/sdk';
import type { ClientSession as Session } from '@moxxy/sdk';
import type { DiscordPermissionResolver } from '../permission.js';
import { BUTTON_STYLE, button, packRows } from './components.js';
import type { ChannelLogger, SendableChannelLike } from './discord-like.js';

export interface PermissionPromptDeps {
  readonly channel: SendableChannelLike | null;
  readonly session: Session | null;
  readonly resolver: DiscordPermissionResolver;
  readonly yolo: boolean;
  readonly logger?: ChannelLogger;
}

function truncate(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, max - 1) + '…';
}

/**
 * Render a button-row permission prompt for a pending tool call (the Discord
 * mapping of Telegram's inline keyboard). The decider promise resolves when
 * the paired user clicks a button (routed back via the interaction handler)
 * or when the resolver aborts on stop.
 */
export async function askForPermission(
  call: PendingToolCall,
  ctx: PermissionContext,
  deps: PermissionPromptDeps,
): Promise<void> {
  void ctx;
  if (!deps.channel || !deps.session) return;
  // YOLO short-circuit: resolve immediately without rendering a prompt.
  if (deps.yolo) {
    deps.resolver.resolvePending(call.callId, { mode: 'allow', reason: 'yolo mode' });
    return;
  }
  const rows = packRows([
    button(`perm:${call.callId}:allow`, 'Allow once', BUTTON_STYLE.success),
    button(`perm:${call.callId}:allow_session`, 'Allow session', BUTTON_STYLE.primary),
    button(`perm:${call.callId}:deny`, 'Deny', BUTTON_STYLE.danger),
  ]);
  const description = deps.session.tools.get(call.name)?.description ?? '';
  const summary =
    `🔐 **Tool permission requested**\n` +
    `Tool: \`${call.name}\`\n` +
    (description ? `Desc: ${truncate(description, 200)}\n` : '') +
    `Input: \`${truncate(JSON.stringify(call.input), 300)}\``;
  try {
    await deps.channel.send({ content: summary, components: rows });
  } catch (err) {
    deps.logger?.warn('discord permission send failed', { err: String(err) });
    deps.resolver.resolvePending(call.callId, { mode: 'deny', reason: 'unable to render prompt' });
  }
}
