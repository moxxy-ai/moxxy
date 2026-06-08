import { describe, expect, it } from 'vitest';
import { claudeCodeProviderDef, createClaudeCodeClient } from './index.js';

describe('claude-code provider definition', () => {
  it('registers as an OAuth provider named claude-code with Claude models', () => {
    expect(claudeCodeProviderDef.name).toBe('claude-code');
    expect(claudeCodeProviderDef.auth?.kind).toBe('oauth');
    expect(claudeCodeProviderDef.models.length).toBeGreaterThan(0);
    expect(claudeCodeProviderDef.models.map((m) => m.id)).toContain('claude-sonnet-4-6');
  });

  it('builds an OAuth-mode client that reports the claude-code name', () => {
    const client = createClaudeCodeClient({ oauthToken: 'tok' });
    expect(client.name).toBe('claude-code');
    const inner = (client as unknown as { client: { apiKey: unknown; authToken: unknown } }).client;
    expect(inner.apiKey).toBeNull();
    expect(inner.authToken).toBe('tok');
  });
});
