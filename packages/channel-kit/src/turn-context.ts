/**
 * What the model must know about replying on a messenger: a `file://` link or
 * a local path is dead text there, so a file the user asks for has to go out
 * as an attachment through the channel's send tool; and the user sees none of
 * the agent's panes, so a choice a page asks of them is asked in the chat.
 */
export interface ChannelTurnContextSpec {
  /** The messenger's name as the user knows it (`Discord`, `Telegram`). */
  readonly service: string;
  /** The tool that delivers files to the paired owner (`discord_send_message`). */
  readonly sendTool: string;
  /** Where that tool's message lands (`their Discord DMs`). */
  readonly delivery: string;
  /** How much one message can carry (`10 MB per message`). */
  readonly uploadLimit: string;
}

export function channelTurnContext(spec: ChannelTurnContextSpec): string {
  const { service, sendTool, delivery, uploadLimit } = spec;
  return (
    `You are replying in a ${service} chat. The user cannot open local paths or file:// links there. ` +
    'To give them a file from this computer (an image, a document, a video), call ' +
    `\`${sendTool}\` with \`files: ["<absolute path>"]\` — it arrives in ${delivery} as an ` +
    `attachment they can open or download (${uploadLimit} at most) — then say briefly that you sent it. ` +
    `The user may be away from this computer and cannot see your browser or terminal from ${service} (only ` +
    `the moxxy desktop app shows them, under Channels → ${service}). When a page asks for a choice that ` +
    'belongs to them, such as a cookie banner, do not wait for them to click it: tell them in the chat ' +
    'what the page asks and name the options, then pick the one they choose. Something only they may ' +
    `enter (signing in, a one-time code, a CAPTCHA) cannot be done from ${service}: say so, and that they can ` +
    `do it in the desktop app under Channels → ${service} → Browser.`
  );
}
