import { afterEach, describe, expect, it } from 'vitest';

import { setupAgent, openaiPreset, anthropicPreset } from './index.js';

const ORIGINAL_OPENAI = process.env.OPENAI_API_KEY;
afterEach(() => {
  if (ORIGINAL_OPENAI === undefined) delete process.env.OPENAI_API_KEY;
  else process.env.OPENAI_API_KEY = ORIGINAL_OPENAI;
});

describe('@moxxy/agent presets', () => {
  it('openaiPreset → a single-call agent with openai active', () => {
    const agent = setupAgent(openaiPreset({ apiKey: 'sk-test' }));
    expect(agent.session.providers.getActiveName()).toBe('openai');
    expect(typeof agent.ask).toBe('function');
    expect(typeof agent.stream).toBe('function');
  });

  it('anthropicPreset → anthropic active', () => {
    const agent = setupAgent(anthropicPreset({ apiKey: 'sk-ant' }));
    expect(agent.session.providers.getActiveName()).toBe('anthropic');
  });

  it('an array of presets registers both providers (first active) and de-dupes the shared mode', () => {
    const agent = setupAgent([openaiPreset({ apiKey: 'a' }), anthropicPreset({ apiKey: 'b' })]);
    expect(agent.session.providers.getActiveName()).toBe('openai');
    expect(
      agent.session.providers
        .list()
        .map((d) => d.name)
        .sort(),
    ).toEqual(['anthropic', 'openai']);
    agent.setProvider('anthropic');
    expect(agent.session.providers.getActiveName()).toBe('anthropic');
  });

  it('falls back to the conventional env var for the api key', () => {
    process.env.OPENAI_API_KEY = 'env-key';
    expect(openaiPreset().provider?.config?.apiKey).toBe('env-key');
    expect(openaiPreset({ apiKey: 'explicit' }).provider?.config?.apiKey).toBe('explicit');
  });

  it('passes baseURL and model through to provider.config', () => {
    const config = openaiPreset({ apiKey: 'sk-test', model: 'x', baseURL: 'y' }).provider?.config;
    expect(config?.model).toBe('x');
    expect(config?.baseURL).toBe('y');
  });

  it('omits absent fields entirely (not as undefined) so provider defaults win', () => {
    delete process.env.OPENAI_API_KEY;
    const config = openaiPreset().provider?.config ?? {};
    // Absent keys must not exist at all — a present `undefined`/`''` would
    // override the provider's own catalog/env fallback.
    expect('model' in config).toBe(false);
    expect('baseURL' in config).toBe(false);
    expect('apiKey' in config).toBe(false);
  });

  it('treats an empty-string env var as absent so the provider fallback survives', () => {
    process.env.OPENAI_API_KEY = '';
    const config = openaiPreset().provider?.config ?? {};
    // `OPENAI_API_KEY=` must not freeze apiKey:'' (which `'' ?? x` would keep,
    // defeating the provider's lazy env fallback and yielding an opaque 401).
    expect('apiKey' in config).toBe(false);
  });

  it('treats an explicit empty-string apiKey/model/baseURL as absent', () => {
    delete process.env.OPENAI_API_KEY;
    const config = openaiPreset({ apiKey: '', model: '', baseURL: '' }).provider?.config ?? {};
    expect('apiKey' in config).toBe(false);
    expect('model' in config).toBe(false);
    expect('baseURL' in config).toBe(false);
  });
});
