import { describe, expect, it } from 'vitest';
import { channelTurnContext } from './turn-context.js';

const telegram = channelTurnContext({
  service: 'Telegram',
  sendTool: 'telegram_send_message',
  delivery: 'their Telegram chat with the bot',
  uploadLimit: '50 MB per file',
});

describe('channelTurnContext (what the model must know about replying on a messenger)', () => {
  it('names the messenger the reply goes to', () => {
    expect(telegram).toMatch(/^You are replying in a Telegram chat\./);
  });

  it('tells the model to send a file through the channel tool instead of linking a local path', () => {
    expect(telegram).toContain('cannot open local paths or file:// links');
    expect(telegram).toContain('`telegram_send_message` with `files: ["<absolute path>"]`');
    expect(telegram).toContain('their Telegram chat with the bot');
    expect(telegram).toContain('50 MB per file');
  });

  it('asks in the chat only about a cookie banner that cannot be declined, as on every other surface', () => {
    expect(telegram).toContain('such as a cookie banner that shows no way to decline');
  });

  it('points at the desktop pane for this channel for what only the user may enter', () => {
    expect(telegram).toContain('under Channels → Telegram');
    expect(telegram).toContain('Channels → Telegram → Browser');
  });
});
