import { describe, expect, it } from 'vitest';
import { CLAUDE_CODE_SYSTEM, CLAUDE_OAUTH_BETA } from './constants.js';
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

  it('forwards the OAuth beta headers and identity preamble to AnthropicProvider', () => {
    // These two are load-bearing: a subscription token is rejected by the
    // Messages API unless `anthropic-beta: oauth-2025-04-20` is sent and the
    // system prompt leads with the exact CLAUDE_CODE_SYSTEM line. A silent
    // drop/typo in the forwarding object compiles fine and only surfaces as a
    // runtime 401/400 — pin the contract here.
    const client = createClaudeCodeClient({ oauthToken: 'tok' });
    const oauth = (
      client as unknown as { oauth: { beta: ReadonlyArray<string>; systemPreamble?: string } }
    ).oauth;
    expect(oauth.beta).toEqual([...CLAUDE_OAUTH_BETA]);
    expect(oauth.beta).toContain('oauth-2025-04-20');
    expect(oauth.beta).toContain('claude-code-20250219');
    expect(oauth.systemPreamble).toBe(CLAUDE_CODE_SYSTEM);
  });
});
