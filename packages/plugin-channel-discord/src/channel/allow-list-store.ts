import type { VaultStore } from '@moxxy/plugin-vault';
import {
  DISCORD_ALLOWED_CHANNELS_KEY,
  parseAllowedChannels,
  serializeAllowedChannels,
  snowflakeSchema,
} from '../keys.js';

/**
 * Vault-backed guild-channel allow-list: the channels (beyond the paired
 * user's DM) the paired user may drive the session from. Managed via the
 * local `/allow` and `/deny` commands; persisted as a JSON snowflake array
 * under {@link DISCORD_ALLOWED_CHANNELS_KEY} (corrupt values read as empty —
 * deny-by-default).
 */
export class AllowListStore {
  private ids = new Set<string>();

  constructor(private readonly vault: VaultStore) {}

  async load(): Promise<void> {
    this.ids = new Set(parseAllowedChannels(await this.vault.get(DISCORD_ALLOWED_CHANNELS_KEY)));
  }

  snapshot(): ReadonlySet<string> {
    return this.ids;
  }

  has(channelId: string): boolean {
    return this.ids.has(channelId);
  }

  /** Add a channel id. Returns false (no write) for a non-snowflake id. */
  async add(channelId: string): Promise<boolean> {
    if (!snowflakeSchema.safeParse(channelId).success) return false;
    if (this.ids.has(channelId)) return true;
    this.ids.add(channelId);
    await this.persist();
    return true;
  }

  /** Remove a channel id. Returns true when it was present. */
  async remove(channelId: string): Promise<boolean> {
    const removed = this.ids.delete(channelId);
    if (removed) await this.persist();
    return removed;
  }

  private async persist(): Promise<void> {
    await this.vault.set(DISCORD_ALLOWED_CHANNELS_KEY, serializeAllowedChannels(this.ids));
  }
}
