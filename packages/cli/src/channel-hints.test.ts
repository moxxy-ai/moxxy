import { describe, expect, it } from 'vitest';
import { findCatalogEntryForChannel } from './channel-hints.js';

describe('findCatalogEntryForChannel', () => {
  // The hint is derived from catalog `provides` declarations — every channel
  // shipped as an unbundled package must resolve, or `moxxy <name>` on a slim
  // kernel degrades to a bare "unknown command" instead of an install hint.
  it.each([
    ['telegram', '@moxxy/plugin-telegram'],
    ['slack', '@moxxy/plugin-channel-slack'],
    ['signal', '@moxxy/plugin-channel-signal'],
    ['whatsapp', '@moxxy/plugin-channel-whatsapp'],
    ['discord', '@moxxy/plugin-channel-discord'],
    ['imessage', '@moxxy/plugin-channel-imessage'],
    ['web', '@moxxy/plugin-channel-web'],
    ['http', '@moxxy/plugin-channel-http'],
  ])('%s → %s', (command, packageName) => {
    expect(findCatalogEntryForChannel(command)?.packageName).toBe(packageName);
  });

  it('is case-insensitive on the command', () => {
    expect(findCatalogEntryForChannel('Telegram')?.packageName).toBe('@moxxy/plugin-telegram');
  });

  it('unknown names stay unknown', () => {
    expect(findCatalogEntryForChannel('nonexistent-channel')).toBeUndefined();
    expect(findCatalogEntryForChannel('')).toBeUndefined();
  });

  it('never resolves non-channel catalog entries', () => {
    // Providers/modes share the catalog; a provider slug must not read as a channel.
    expect(findCatalogEntryForChannel('anthropic')).toBeUndefined();
    expect(findCatalogEntryForChannel('goal')).toBeUndefined();
  });
});
