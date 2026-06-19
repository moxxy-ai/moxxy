import { describe, expect, it } from 'vitest';
import { xaiPlugin, xaiProviderDef, grokModels } from './index.js';

describe('@moxxy/plugin-provider-xai', () => {
  it('registers the xai provider', () => {
    expect(xaiPlugin.providers?.map((p) => p.name)).toEqual(['xai']);
  });

  it('advertises the Grok catalog (including the 1M-context grok-4.3 flagship)', () => {
    expect(xaiProviderDef.models).toEqual(grokModels);
    expect(grokModels.find((m) => m.id === 'grok-4.3')).toMatchObject({ contextWindow: 1_000_000 });
  });

  it('createClient stamps the xai slug so usage/errors attribute to xAI, not openai', () => {
    const client = xaiProviderDef.createClient({ apiKey: 'xai-test-key' });
    expect(client.name).toBe('xai');
    expect(client.models).toEqual(grokModels);
  });

  it('exposes an apiKey auth descriptor', () => {
    expect(xaiProviderDef.auth).toMatchObject({ kind: 'apiKey' });
  });

  it('the reasoning-tier Grok models advertise supportsReasoning', () => {
    // Reasoning gating (reasoning_effort + reasoning-stream surfacing) keys off
    // this flag; absent it, the loop silently drops reasoning config even when
    // the user enables it. The grok-4 family + grok-3-mini are reasoning models.
    const reasoningIds = ['grok-4.3', 'grok-4', 'grok-4-fast', 'grok-code-fast-1', 'grok-3-mini'];
    for (const id of reasoningIds) {
      expect(grokModels.find((m) => m.id === id)?.supportsReasoning, id).toBe(true);
    }
    // The non-mini grok-3 is NOT a reasoning model — keep the flag off so the
    // loop doesn't request reasoning the model won't honor.
    expect(grokModels.find((m) => m.id === 'grok-3')?.supportsReasoning).toBeUndefined();
  });

  it('every Grok descriptor carries a positive, in-window maxOutputTokens budget', () => {
    // Without maxOutputTokens the context budgeter can't reserve completion
    // space, so a near-full window + large generation gets server-truncated
    // instead of pre-emptively elided.
    for (const m of grokModels) {
      expect(typeof m.maxOutputTokens, `${m.id} maxOutputTokens`).toBe('number');
      expect(m.maxOutputTokens!, `${m.id} maxOutputTokens > 0`).toBeGreaterThan(0);
      expect(m.maxOutputTokens!, `${m.id} maxOutputTokens <= contextWindow`).toBeLessThanOrEqual(m.contextWindow);
    }
  });
});
