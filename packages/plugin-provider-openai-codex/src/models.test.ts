import { describe, expect, it } from 'vitest';
import { openaiCodexProviderDef } from './index.js';

describe('current Codex OAuth catalog', () => {
  it.each(['gpt-6-astra', 'gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna', 'gpt-5.3-codex-spark'])('exposes %s to model pickers', (id) => {
    expect(openaiCodexProviderDef.models.find((model) => model.id === id)).toMatchObject({
      supportsTools: true, supportsStreaming: true, supportsReasoning: true,
    });
  });
});
