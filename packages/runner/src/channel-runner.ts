import { moxxyPath } from '@moxxy/sdk/server';
import { platformSocket } from './socket-path.js';

/**
 * Addressing of a DEDICATED channel runner (a Discord/Telegram/… bot running
 * as its own agent thread): its own socket plus one sticky session. The bot
 * listens here and the desktop attaches here, so both derive it from this one
 * place instead of hand-building the name.
 */
export function channelRunnerSocket(
  name: string,
  platform: NodeJS.Platform = process.platform,
): string {
  return platformSocket(`channel-${name}`, moxxyPath(`channel-${name}.sock`), platform);
}

/** The bot's sticky session id — its conversation survives restarts. */
export function channelSessionId(name: string): string {
  return `moxxy-channel-${name}`;
}
