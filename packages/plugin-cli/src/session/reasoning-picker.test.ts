import { describe, expect, it } from 'vitest';
import type { ProviderInfo, SessionInfo } from '@moxxy/sdk';
import { withSessionReasoning } from './reasoning-picker.js';

const capabilities = { contextWindow: 100, supportsTools: true, supportsStreaming: true };
const provider: ProviderInfo = {
  name: 'codex-agent', agentName: 'Codex', authKind: 'oauth', supportsLiveModelDiscovery: true,
  models: [
    { id: 'terra', ...capabilities, supportsReasoning: true, reasoningEfforts: ['low', 'max', 'ultra'] },
    { id: 'luna', ...capabilities, supportsReasoning: true, reasoningEfforts: ['low', 'max'] },
    { id: 'plain', ...capabilities },
  ],
};
const info = { activeProvider: provider.name, providers: [provider], defaultModel: 'terra', reasoningEffort: 'ultra' } as const satisfies Partial<SessionInfo>;
const settings = { kind: 'settings', title: 'Settings', options: [] } as const;
const levels = { kind: 'reasoning', title: 'Model reasoning', options: [] } as const;

describe('reasoning in the terminal settings', () => {
  it('shows the current conversation and selects only levels supported by the model of the next turn', () => {
    expect(withSessionReasoning(settings, info).options).toContainEqual(expect.objectContaining({ label: 'Model reasoning', badge: 'ultra' }));
    expect(withSessionReasoning(levels, info).options).toEqual([
      expect.objectContaining({ id: 'low', current: false }),
      expect.objectContaining({ id: 'max', current: false }),
      expect.objectContaining({ id: 'ultra', current: true }),
    ]);
    expect(withSessionReasoning(levels, { ...info, reasoningEffort: 'max' }, 'luna').options.map(o => o.id)).toEqual(['low', 'max']);
    expect(withSessionReasoning(settings, info, 'plain').options).toEqual([]);
  });

  it('preserves off and the classic levels for an API model without an effort list', () => {
    const api: ProviderInfo = { name: 'api', authKind: 'api-key', supportsLiveModelDiscovery: false,
      models: [{ id: 'classic', ...capabilities, supportsReasoning: true }] };
    const apiInfo = { activeProvider: 'api', providers: [api], defaultModel: 'classic', reasoningEffort: null };
    expect(withSessionReasoning(levels, apiInfo).options.map(o => o.id)).toEqual(['off', 'low', 'medium', 'high', 'xhigh']);
    expect(withSessionReasoning(settings, apiInfo).options[0]?.badge).toBe('off');
    expect(withSessionReasoning(settings, { activeProvider: 'api', providers: [api] }).options).toEqual([]);
  });
});
