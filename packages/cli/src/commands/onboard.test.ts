import { describe, expect, it } from 'vitest';
import { buildChannelChoices, catalogChannelEntry } from './onboard.js';

describe('catalogChannelEntry', () => {
  it('resolves every onboardable messenger through catalog `provides`', () => {
    for (const name of ['discord', 'telegram', 'whatsapp', 'signal', 'slack']) {
      const entry = catalogChannelEntry(name);
      expect(entry, name).toBeDefined();
      expect(entry!.provides).toEqual(
        expect.arrayContaining([{ category: 'channel', name }]),
      );
    }
  });

  it('returns undefined for non-channels', () => {
    expect(catalogChannelEntry('anthropic')).toBeUndefined();
  });
});

describe('buildChannelChoices', () => {
  it('keeps the curated presentation order', () => {
    const choices = buildChannelChoices(new Set());
    expect(choices.map((c) => c.value)).toEqual([
      'discord',
      'telegram',
      'whatsapp',
      'signal',
      'slack',
    ]);
  });

  it('marks already-registered channels as installed', () => {
    const choices = buildChannelChoices(new Set(['telegram']));
    const telegram = choices.find((c) => c.value === 'telegram')!;
    const discord = choices.find((c) => c.value === 'discord')!;
    expect(telegram.installed).toBe(true);
    expect(telegram.hint).toMatch(/^installed · /);
    expect(discord.installed).toBe(false);
    expect(discord.hint).not.toMatch(/installed/);
  });

  it('labels come from the catalog, not the curated list', () => {
    for (const choice of buildChannelChoices(new Set())) {
      expect(choice.label).toBe(choice.entry.label);
      expect(choice.entry.packageName.startsWith('@moxxy/')).toBe(true);
    }
  });

  it('surfaces the WhatsApp ToS warning in its hint', () => {
    const whatsapp = buildChannelChoices(new Set()).find((c) => c.value === 'whatsapp')!;
    expect(whatsapp.hint).toMatch(/ToS|UNOFFICIAL/i);
  });
});
