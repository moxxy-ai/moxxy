import { describe, expect, it } from 'vitest';
import { CHANNEL_CATALOG, listChannelCatalog } from './channel-catalog';

describe('CHANNEL_CATALOG', () => {
  it('pins the exact vault keys each channel plugin reads', () => {
    // These MUST match the plugins' keys.ts (slack: SLACK_*_KEY, telegram:
    // TELEGRAM_TOKEN_KEY). A drift here is a silent misconfig — the desktop would
    // save a secret under a name the channel never reads. Pin them so it's caught.
    expect(CHANNEL_CATALOG.slack?.vaultKeys).toEqual({
      botToken: 'slack_bot_token',
      signingSecret: 'slack_signing_secret',
    });
    expect(CHANNEL_CATALOG.slack?.requiredKeys).toEqual([
      'slack_bot_token',
      'slack_signing_secret',
    ]);
    expect(CHANNEL_CATALOG.telegram?.vaultKeys).toEqual({ botToken: 'telegram_bot_token' });
    expect(CHANNEL_CATALOG.telegram?.requiredKeys).toEqual(['telegram_bot_token']);
  });

  it('keeps every entry internally consistent', () => {
    for (const entry of listChannelCatalog()) {
      const { descriptor, vaultKeys, requiredKeys } = entry;
      // The catalog key equals the descriptor id (== the CLI subcommand).
      expect(CHANNEL_CATALOG[descriptor.id]).toBe(entry);
      // Every config field maps to a vault key, and every required key is one of
      // those mapped keys (so saving the fields can satisfy "configured").
      for (const field of descriptor.configFields) {
        expect(vaultKeys[field.name]).toBeTruthy();
      }
      for (const key of requiredKeys) {
        expect(Object.values(vaultKeys)).toContain(key);
      }
    }
  });

  it('only Slack advertises a public Request URL', () => {
    expect(CHANNEL_CATALOG.slack?.descriptor.hasWebhookUrl).toBe(true);
    expect(CHANNEL_CATALOG.telegram?.descriptor.hasWebhookUrl).toBe(false);
  });
});
