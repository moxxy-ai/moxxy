/**
 * The provider step offers an agent connection's CLI install where the person
 * picks the agent, before signing in, with the same row Settings shows, and
 * groups the picker so a coding agent (SDK) reads apart from a model API.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { __setApiOverride } from '@moxxy/client-core';
import type { ProviderEntry } from '@moxxy/desktop-ipc-contract';
import { ProviderStep } from './ProviderStep';

afterEach(() => {
  __setApiOverride(null);
});

const codex: ProviderEntry = {
  name: 'codex-agent',
  agentName: 'Codex',
  ready: false,
  enabled: true,
  active: false,
  authKind: 'oauth',
  kind: 'builtin',
  keyName: 'CODEX_AGENT_API_KEY',
  agentCli: { state: 'missing', command: 'codex', installed: null, latest: '0.162.1', minimum: '0.155.1', checkedAt: 1 },
};

describe('ProviderStep', () => {
  it('offers to install a missing agent CLI when that agent is picked', async () => {
    const calls: Array<[string, unknown]> = [];
    __setApiOverride({
      invoke: async (cmd: string, args: unknown) => {
        calls.push([cmd, args]);
        if (cmd === 'settings.providerCatalog') {
          return [
            { name: 'anthropic', kind: 'api' },
            { name: 'codex-agent', kind: 'agent' },
          ];
        }
        if (cmd === 'settings.providers') return [codex];
        if (cmd === 'onboarding.providerAuthKind') return 'oauth';
        if (cmd === 'agents.run') return { ok: true, message: 'Installed' };
        return [];
      },
      subscribe: () => () => undefined,
    } as never);
    render(<ProviderStep onNext={() => undefined} onBack={() => undefined} />);

    await waitFor(() => expect(screen.getByRole('option', { name: /codex-agent/ })).toBeInTheDocument());
    expect(screen.queryByTestId('agent-row-codex-agent')).toBeNull();
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'codex-agent' } });

    const row = await screen.findByTestId('agent-row-codex-agent');
    expect(row).toHaveTextContent('Not installed');
    fireEvent.click(screen.getByRole('button', { name: 'Install Codex' }));
    await waitFor(() => expect(calls).toContainEqual(['agents.run', { provider: 'codex-agent', action: 'install' }]));
  });

  it('groups the picker into coding agents and model APIs', async () => {
    __setApiOverride({
      invoke: async (cmd: string) => {
        if (cmd === 'settings.providerCatalog') {
          return [
            { name: 'anthropic', kind: 'api' },
            { name: 'openai', kind: 'api' },
            { name: 'claude-code', kind: 'agent' },
            { name: 'opencode', kind: 'agent' },
          ];
        }
        if (cmd === 'onboarding.providerAuthKind') return 'api-key';
        return [];
      },
      subscribe: () => () => undefined,
    } as never);
    render(<ProviderStep onNext={() => undefined} onBack={() => undefined} />);

    const agents = await screen.findByRole('group', { name: 'SDK · OAuth login' });
    const apis = screen.getByRole('group', { name: 'API · API key login' });
    const names = (group: HTMLElement): string[] =>
      within(group).getAllByRole('option').map((option) => option.textContent ?? '');
    expect(names(agents)).toEqual(['claude-code', 'opencode']);
    expect(names(apis)).toEqual(['anthropic', 'openai']);
  });
});
