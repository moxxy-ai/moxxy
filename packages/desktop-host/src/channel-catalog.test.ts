import { describe, expect, it } from 'vitest';
import type { ChannelDef } from '@moxxy/sdk';
import { CHANNEL_CATALOG, listChannelCatalog, type ChannelCatalogEntry } from './channel-catalog';
import { assertDefined } from '@moxxy/sdk';

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

  // The `connect` descriptor is exactly what the Channels panel renders as the
  // post-start "connect the other side" step, so a typo'd/missing kind is caught
  // here rather than by eyeballing the running app.
  it('Telegram declares a QR connect step that opens the bot link', () => {
    const connect = CHANNEL_CATALOG.telegram?.descriptor.connect;
    expect(connect?.kind).toBe('qr');
    // The t.me link is an https URL the user OPENS (not pastes) → open affordance.
    expect(connect?.openable).toBe(true);
    expect(connect?.openLabel).toBeTruthy();
  });

  it('Slack declares a URL connect step the user pastes (not opens)', () => {
    const connect = CHANNEL_CATALOG.slack?.descriptor.connect;
    expect(connect?.kind).toBe('url');
    expect(connect?.openable).toBeFalsy();
  });

  it('every declared connect kind is one the renderer handles', () => {
    const handled = new Set(['qr', 'url', 'instructions']);
    for (const entry of listChannelCatalog()) {
      const c = entry.descriptor.connect;
      if (c) expect(handled.has(c.kind)).toBe(true);
    }
  });
});

/**
 * Drift guard against the ACTUAL plugin defs.
 *
 * The tests above pin the catalog to hardcoded expectations — but those
 * expectations were hand-copied from the plugins too, so they can rot in
 * lockstep with the catalog. This block instead imports each channel plugin's
 * `ChannelDef` DIRECTLY from its package source (the single source of truth) and
 * asserts the catalog still matches the LOAD-BEARING contract, keyed by
 * `vaultKey` (where the secret actually lives): which vault keys exist, which are
 * required, each field's secret/text type, and `hasWebhookUrl`. The desktop
 * writes each field under `vaultKeys[field]` and the channel reads it from the
 * vault by that exact key, so a vaultKey drift silently breaks the channel.
 *
 * It deliberately does NOT assert presentation the desktop and the plugin word
 * differently — field option-names, labels, placeholders, help, runHint, connect
 * copy: those have intentionally diverged and coupling them would be brittle
 * without protecting anything load-bearing.
 *
 * Imports reach into each plugin's `src/index.ts` by relative path rather than by
 * package name on purpose: desktop-host doesn't (and shouldn't) depend on the
 * channel plugins, so this keeps the comparison honest without adding a heavy
 * runtime dependency on grammy / baileys / discord.js. Test files are excluded
 * from `tsconfig.json`, so the cross-package import doesn't affect the build.
 */
type PluginModule = { default?: { channels?: ReadonlyArray<ChannelDef> } };

// Catalog id -> loader for the plugin whose `channels[0]` is the mirrored def.
// Every id in CHANNEL_CATALOG MUST appear here (asserted below) so a new catalog
// entry can't silently skip its drift check.
const PLUGIN_LOADERS: Readonly<Record<string, () => Promise<PluginModule>>> = {
  slack: () => import('../../plugin-channel-slack/src/index.ts'),
  telegram: () => import('../../plugin-telegram/src/index.ts'),
  signal: () => import('../../plugin-channel-signal/src/index.ts'),
  whatsapp: () => import('../../plugin-channel-whatsapp/src/index.ts'),
  discord: () => import('../../plugin-channel-discord/src/index.ts'),
  imessage: () => import('../../plugin-channel-imessage/src/index.ts'),
};

type FieldContract = { readonly required: boolean; readonly type: 'password' | 'text' };

/** The def's secret contract, keyed by vaultKey. */
async function defContract(id: string): Promise<{
  readonly fields: Map<string, FieldContract>;
  readonly requiredKeys: ReadonlyArray<string>;
  readonly hasRequestUrl: boolean;
}> {
  const loader = PLUGIN_LOADERS[id];
  assertDefined(loader, `plugin loader for channel "${id}"`);
  const mod = await loader();
  const channels = mod.default?.channels;
  const firstChannel = channels?.[0];
  const config = firstChannel?.config;
  if (!config) throw new Error(`no ChannelDef.config for channel "${id}"`);
  const fields = new Map<string, FieldContract>(
    config.fields.map((f) => [f.vaultKey, { required: f.required === true, type: f.secret ? 'password' : 'text' }]),
  );
  return {
    fields,
    requiredKeys: config.fields.filter((f) => f.required === true).map((f) => f.vaultKey),
    hasRequestUrl: config.hasRequestUrl === true,
  };
}

/** The catalog entry's secret contract, keyed by vaultKey via its own name->key map. */
function catalogContract(entry: ChannelCatalogEntry): Map<string, FieldContract> {
  return new Map<string, FieldContract>(
    entry.descriptor.configFields.map((f) => {
      const vaultKey = entry.vaultKeys[f.name];
      if (!vaultKey) throw new Error(`catalog field "${f.name}" has no vaultKeys entry`);
      return [vaultKey, { required: f.required === true, type: f.type }];
    }),
  );
}

describe('channel-catalog drift guard (vs plugin defs)', () => {
  it('has a drift check for every channel in the catalog', () => {
    expect(Object.keys(PLUGIN_LOADERS).sort()).toEqual(Object.keys(CHANNEL_CATALOG).sort());
  });

  for (const [id, entry] of Object.entries(CHANNEL_CATALOG)) {
    describe(id, () => {
      it('vault keys, required flags and secret/text types match the plugin def', async () => {
        const def = await defContract(id);
        expect(catalogContract(entry)).toEqual(def.fields);
      });

      it('requiredKeys match the def’s required vault keys', async () => {
        const def = await defContract(id);
        expect([...entry.requiredKeys].sort()).toEqual([...def.requiredKeys].sort());
      });

      it('hasWebhookUrl matches the def’s hasRequestUrl', async () => {
        const def = await defContract(id);
        expect(entry.descriptor.hasWebhookUrl).toBe(def.hasRequestUrl);
      });
    });
  }
});
