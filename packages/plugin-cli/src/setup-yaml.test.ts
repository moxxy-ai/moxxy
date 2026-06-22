import { describe, expect, it } from 'vitest';
import { renderYaml, yamlScalar } from './setup-yaml.js';

const base = {
  apiKeys: {},
  primary: 'anthropic',
  model: 'claude-sonnet-4-6',
  mode: 'default',
  embedder: 'tfidf',
};

describe('renderYaml', () => {
  it('renders a minimal single-provider config (anthropic + tfidf)', () => {
    const yaml = renderYaml({ ...base, providers: ['anthropic'] });
    expect(yaml).toContain('provider:');
    expect(yaml).toContain('name: anthropic');
    expect(yaml).toContain('model: claude-sonnet-4-6');
    expect(yaml).toContain('apiKey: ${vault:ANTHROPIC_API_KEY}');
    expect(yaml).toContain('mode: default');
    // TF-IDF is the default — no embeddings block emitted.
    expect(yaml).not.toContain('embeddings:');
    // No fallbacks for single-provider setup.
    expect(yaml).not.toContain('fallbacks:');
  });

  it('emits fallbacks when multiple providers are selected, excluding the primary', () => {
    const yaml = renderYaml({
      ...base,
      providers: ['anthropic', 'openai'],
      primary: 'anthropic',
    });
    expect(yaml).toContain('fallbacks:');
    expect(yaml).toMatch(/- openai/);
    // Primary should NOT appear in the fallbacks list
    expect(yaml.split('fallbacks:')[1] ?? '').not.toContain('anthropic');
  });

  it('different primary inverts the fallback ordering', () => {
    const yaml = renderYaml({
      ...base,
      providers: ['anthropic', 'openai'],
      primary: 'openai',
    });
    expect(yaml).toContain('name: openai');
    expect(yaml).toContain('apiKey: ${vault:OPENAI_API_KEY}');
    expect(yaml).toMatch(/- anthropic/);
  });

  it('emits an embeddings block when embedder is not tfidf', () => {
    const yaml = renderYaml({ ...base, providers: ['anthropic'], embedder: 'openai' });
    expect(yaml).toContain('embeddings:');
    expect(yaml).toContain('provider: openai');
  });

  it('skips the model line when no model is selected', () => {
    const yaml = renderYaml({ ...base, providers: ['anthropic'], model: null });
    expect(yaml).not.toMatch(/^\s*model:/m);
    // Provider block still emitted
    expect(yaml).toContain('name: anthropic');
  });

  it('honors the chosen mode strategy', () => {
    const yaml = renderYaml({ ...base, providers: ['anthropic'], mode: 'research' });
    expect(yaml).toContain('mode: research');
  });

  it('output starts with a generator comment', () => {
    const yaml = renderYaml({ ...base, providers: ['anthropic'] });
    expect(yaml.startsWith('# moxxy.config.yaml')).toBe(true);
  });

  it('vault placeholder uses the canonical uppercase provider name', () => {
    const yaml = renderYaml({ ...base, providers: ['openai'], primary: 'openai' });
    expect(yaml).toContain('${vault:OPENAI_API_KEY}');
  });

  it('produces a config that parses as valid YAML', async () => {
    const yaml = renderYaml({
      ...base,
      providers: ['anthropic', 'openai'],
      embedder: 'transformers',
    });
    const yamlMod = (await import('yaml')) as typeof import('yaml');
    const parsed = yamlMod.parse(yaml);
    expect(parsed.provider.name).toBe('anthropic');
    expect(parsed.provider.fallbacks).toEqual(['openai']);
    expect(parsed.embeddings.provider).toBe('transformers');
    expect(parsed.mode).toBe('default');
  });

  it('omits the apiKey vault line when the primary provider authenticates via OAuth', () => {
    const yaml = renderYaml({
      ...base,
      providers: ['openai-codex'],
      primary: 'openai-codex',
      model: null,
      authKinds: { 'openai-codex': 'oauth' },
    });
    expect(yaml).toContain('name: openai-codex');
    // OAuth providers persist tokens under a provider-specific vault key,
    // not a generic *_API_KEY entry — the config must not reference one.
    expect(yaml).not.toContain('apiKey:');
    expect(yaml).not.toContain('config:');
  });

  it('still emits apiKey for an API-key primary even when a fallback is OAuth', () => {
    const yaml = renderYaml({
      ...base,
      providers: ['anthropic', 'openai-codex'],
      primary: 'anthropic',
      authKinds: { 'openai-codex': 'oauth' },
    });
    expect(yaml).toContain('apiKey: ${vault:ANTHROPIC_API_KEY}');
    expect(yaml).toMatch(/- openai-codex/);
  });

  it('keeps the vault placeholder unquoted (loader matches it literally)', () => {
    const yaml = renderYaml({ ...base, providers: ['anthropic'] });
    // Must NOT be wrapped in quotes despite containing a `:` — the config
    // loader recognizes the bare ${vault:...} form.
    expect(yaml).toContain('apiKey: ${vault:ANTHROPIC_API_KEY}');
    expect(yaml).not.toContain('apiKey: "${vault:');
  });

  it('produces VALID yaml even when ids carry YAML-special characters (worst case)', async () => {
    // Hostile / unexpected ids: a `:` in a model id, a `#` in an embedder, a
    // leading-dash mode, whitespace + quote in an isolator. None of these can
    // be allowed to silently corrupt the generated config file.
    const yaml = renderYaml({
      apiKeys: {},
      providers: ['my:provider', 'other'],
      primary: 'my:provider',
      model: 'gpt-4 #turbo: "fast"',
      mode: '-weird mode',
      embedder: 'em#bed',
      security: { enabled: true, isolator: 'iso lator"x' },
    });
    const yamlMod = (await import('yaml')) as typeof import('yaml');
    // The whole document must still parse — no thrown YAMLParseError, no
    // truncated/aliased value.
    const parsed = yamlMod.parse(yaml);
    expect(parsed.provider.name).toBe('my:provider');
    expect(parsed.provider.model).toBe('gpt-4 #turbo: "fast"');
    expect(parsed.provider.fallbacks).toEqual(['other']);
    expect(parsed.mode).toBe('-weird mode');
    expect(parsed.embeddings.provider).toBe('em#bed');
    expect(parsed.security.isolator).toBe('iso lator"x');
  });
});

describe('yamlScalar', () => {
  it('leaves real catalog ids bare (happy path stays unquoted)', () => {
    for (const v of ['anthropic', 'claude-sonnet-4-6', 'openai-codex', 'gpt-4.1', 'default', 'a/b', 'x_y', 'v1.2.3+meta']) {
      expect(yamlScalar(v)).toBe(v);
    }
  });

  it('quotes the empty string (a bare empty value parses as null)', () => {
    expect(yamlScalar('')).toBe('""');
  });

  it('quotes + escapes values carrying YAML indicators / control chars', () => {
    expect(yamlScalar('a: b')).toBe('"a: b"');
    expect(yamlScalar('# comment')).toBe('"# comment"');
    expect(yamlScalar('-leading')).toBe('"-leading"');
    expect(yamlScalar('say "hi"')).toBe('"say \\"hi\\""');
    expect(yamlScalar('back\\slash')).toBe('"back\\\\slash"');
    expect(yamlScalar('line1\nline2')).toBe('"line1\\nline2"');
    expect(yamlScalar('tab\there')).toBe('"tab\\there"');
  });

  it('round-trips every quoted value through a real YAML parser', async () => {
    const yamlMod = (await import('yaml')) as typeof import('yaml');
    for (const v of ['a: b', '# c', '-d', 'e "f"', 'g\\h', 'i\nj', '', '{flow}', '[seq]', '*anchor', '&amp', '!tag', '%dir', '@at', ' lead', 'trail ']) {
      const doc = `k: ${yamlScalar(v)}`;
      expect(yamlMod.parse(doc).k).toBe(v);
    }
  });
});
