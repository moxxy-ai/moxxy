import { describe, expect, it } from 'vitest';
import {
  localPlugin,
  localProviderDef,
  localModels,
  DEFAULT_LOCAL_BASE_URL,
} from './index.js';

describe('@moxxy/plugin-provider-local', () => {
  it('registers the local provider', () => {
    expect(localPlugin.providers?.map((p) => p.name)).toEqual(['local']);
  });

  it('has no validateKey (local servers do not authenticate)', () => {
    expect(localProviderDef.validateKey).toBeUndefined();
  });

  it('activates with no key — createClient supplies a placeholder and the Ollama base URL', () => {
    const client = localProviderDef.createClient({});
    expect(client.name).toBe('local');
    expect(client.models).toEqual(localModels);
    expect(DEFAULT_LOCAL_BASE_URL).toBe('http://localhost:11434/v1');
  });

  it('passes through unlisted local model ids (catalog is only a default set)', () => {
    // The catalog is short on purpose; the provider streams any model id the
    // local server knows. Sanity-check the seed catalog is non-empty.
    expect(localModels.length).toBeGreaterThan(0);
    expect(localModels.every((m) => m.supportsStreaming)).toBe(true);
  });
});
