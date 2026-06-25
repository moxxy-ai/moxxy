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
    expect(yaml).toContain('plugins:');
    expect(yaml).toContain('  provider:');
    expect(yaml).toContain('    default: anthropic');
    expect(yaml).toContain('        model: claude-sonnet-4-6');
    expect(yaml).toContain('  mode:');
    expect(yaml).toContain('    default: default');
    // The key lives in the vault under its canonical name — no apiKey ref.
    expect(yaml).not.toContain('apiKey');
    // TF-IDF is the floor — no embedder block emitted.
    expect(yaml).not.toContain('embedder:');
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
    expect(yaml).toContain('    default: openai');
    expect(yaml).toMatch(/- anthropic/);
  });

  it('emits an embedder block when embedder is not tfidf', () => {
    const yaml = renderYaml({ ...base, providers: ['anthropic'], embedder: 'openai' });
    expect(yaml).toContain('  embedder:');
    expect(yaml).toContain('    default: openai');
  });

  it('skips the items/model block when no model is selected', () => {
    const yaml = renderYaml({ ...base, providers: ['anthropic'], model: null });
    expect(yaml).not.toMatch(/^\s*model:/m);
    expect(yaml).not.toContain('items:');
    // Provider default still emitted.
    expect(yaml).toContain('    default: anthropic');
  });

  it('honors the chosen mode strategy', () => {
    const yaml = renderYaml({ ...base, providers: ['anthropic'], mode: 'research' });
    expect(yaml).toContain('  mode:');
    expect(yaml).toContain('    default: research');
  });

  it('output starts with a generator comment', () => {
    const yaml = renderYaml({ ...base, providers: ['anthropic'] });
    expect(yaml.startsWith('# ~/.moxxy/config.yaml')).toBe(true);
  });

  it('never writes an apiKey ref — the vault holds the key by canonical name', () => {
    const yaml = renderYaml({ ...base, providers: ['openai'], primary: 'openai' });
    expect(yaml).not.toContain('apiKey');
    expect(yaml).not.toContain('config:');
  });

  it('emits a security block only when opted in', () => {
    const off = renderYaml({ ...base, providers: ['anthropic'] });
    expect(off).not.toContain('security:');
    const on = renderYaml({
      ...base,
      providers: ['anthropic'],
      security: { enabled: true, isolator: 'inproc' },
    });
    expect(on).toContain('security:');
    expect(on).toContain('  enabled: true');
  });

  it('produces a config that parses into the unified plugins tree', async () => {
    const yaml = renderYaml({
      ...base,
      providers: ['anthropic', 'openai'],
      embedder: 'transformers',
    });
    const yamlMod = (await import('yaml')) as typeof import('yaml');
    const parsed = yamlMod.parse(yaml);
    expect(parsed.plugins.provider.default).toBe('anthropic');
    expect(parsed.plugins.provider.items.anthropic.model).toBe('claude-sonnet-4-6');
    expect(parsed.plugins.provider.fallbacks).toEqual(['openai']);
    expect(parsed.plugins.embedder.default).toBe('transformers');
    expect(parsed.plugins.mode.default).toBe('default');
  });

  it('produces VALID yaml even when ids carry YAML-special characters (worst case)', async () => {
    // Hostile / unexpected ids: a `:` in the provider (used as a map key!), a
    // `#` in an embedder, a leading-dash mode, whitespace + quote in the model.
    // None of these can be allowed to silently corrupt the generated config.
    const yaml = renderYaml({
      apiKeys: {},
      providers: ['my:provider', 'other'],
      primary: 'my:provider',
      model: 'gpt-4 #turbo: "fast"',
      mode: '-weird mode',
      embedder: 'em#bed',
      security: { enabled: true },
    });
    const yamlMod = (await import('yaml')) as typeof import('yaml');
    // The whole document must still parse — no thrown YAMLParseError, no
    // truncated/aliased value.
    const parsed = yamlMod.parse(yaml);
    expect(parsed.plugins.provider.default).toBe('my:provider');
    expect(parsed.plugins.provider.items['my:provider'].model).toBe('gpt-4 #turbo: "fast"');
    expect(parsed.plugins.provider.fallbacks).toEqual(['other']);
    expect(parsed.plugins.mode.default).toBe('-weird mode');
    expect(parsed.plugins.embedder.default).toBe('em#bed');
    expect(parsed.security.enabled).toBe(true);
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
