import { describe, expect, it } from 'vitest';
import type { AgentCliReport, ProviderInfo } from '@moxxy/sdk';
import { activeAgentCliNotice } from './agent-cli.js';

const report = (over: Partial<AgentCliReport>): AgentCliReport => ({
  state: 'current',
  command: 'codex',
  installed: '0.162.1',
  latest: '0.162.1',
  minimum: '0.155.1',
  checkedAt: 1,
  ...over,
});

const provider = (name: string, agentCli?: AgentCliReport): ProviderInfo =>
  ({ name, models: [], agentName: 'Codex', ...(agentCli ? { agentCli } : {}) }) as ProviderInfo;

describe('activeAgentCliNotice', () => {
  it("says when the active agent's CLI is older than Moxxy works with", () => {
    const providers = [provider('codex-agent', report({ state: 'update-required', installed: '0.150.0' }))];

    expect(activeAgentCliNotice(providers, 'codex-agent')).toEqual({
      provider: 'codex-agent',
      command: 'codex',
      severity: 'required',
      action: 'update',
      text: 'Codex 0.150.0 is older than Moxxy works with — update it to 0.155.1 or newer',
    });
  });

  it('says when the vendor published a newer one', () => {
    const providers = [provider('codex-agent', report({ state: 'update-available', installed: '0.155.1' }))];

    expect(activeAgentCliNotice(providers, 'codex-agent')).toMatchObject({
      severity: 'available',
      text: 'Codex 0.162.1 is out — you have 0.155.1',
    });
  });

  it('says when it is not installed', () => {
    const providers = [provider('codex-agent', report({ state: 'missing', installed: null }))];

    expect(activeAgentCliNotice(providers, 'codex-agent')).toMatchObject({ severity: 'required', action: 'install', text: 'Codex is not installed' });
  });

  it('names the file it checked and where it came from', () => {
    const providers = [
      provider('codex-agent', report({ state: 'update-required', installed: '0.150.0', path: '/opt/homebrew/bin/codex', origin: 'homebrew' })),
    ];

    expect(activeAgentCliNotice(providers, 'codex-agent')).toMatchObject({
      action: 'update',
      text: 'Codex 0.150.0 at /opt/homebrew/bin/codex (Homebrew) is older than Moxxy works with — update it to 0.155.1 or newer',
    });
    expect(
      activeAgentCliNotice([provider('codex-agent', report({ state: 'update-available', installed: '0.155.1', path: '/Users/me/.local/bin/codex', origin: 'installer' }))], 'codex-agent'),
    ).toMatchObject({ text: 'Codex 0.162.1 is out — you have 0.155.1 at /Users/me/.local/bin/codex' });
  });

  it('offers no update of a copy inside an app, which the app updates', () => {
    const inside = '/Applications/ChatGPT.app/Contents/Resources/codex-cli/bin/codex';

    expect(activeAgentCliNotice([provider('codex-agent', report({ state: 'update-required', installed: '0.150.0', path: inside, origin: 'app' }))], 'codex-agent')).toEqual({
      provider: 'codex-agent',
      command: 'codex',
      severity: 'required',
      action: null,
      text: `Codex 0.150.0 at ${inside} is older than Moxxy works with — it is part of ChatGPT.app, which updates it`,
    });
    expect(activeAgentCliNotice([provider('codex-agent', report({ state: 'update-available', installed: '0.155.1', path: inside, origin: 'app' }))], 'codex-agent')).toBeNull();
  });

  it('is quiet when current, unreadable, or about a connection that is not active', () => {
    expect(activeAgentCliNotice([provider('codex-agent', report({}))], 'codex-agent')).toBeNull();
    expect(activeAgentCliNotice([provider('codex-agent', report({ state: 'unknown', installed: null }))], 'codex-agent')).toBeNull();
    expect(activeAgentCliNotice([provider('codex-agent', report({ state: 'update-required' }))], 'anthropic')).toBeNull();
    expect(activeAgentCliNotice([provider('anthropic')], 'anthropic')).toBeNull();
    expect(activeAgentCliNotice([], null)).toBeNull();
  });
});
