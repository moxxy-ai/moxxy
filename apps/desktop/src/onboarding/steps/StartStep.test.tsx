/**
 * The first-run question: a plan the person already pays for, a free model, or
 * an API key. The host behind IPC is the only double: it is the boundary to
 * the main process, as in every onboarding test.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { __resetAgentClisForTests, __setApiOverride } from '@moxxy/client-core';
import type { ProviderEntry } from '@moxxy/desktop-ipc-contract';
import type { AgentCliReport } from '@moxxy/sdk';
import { StartStep } from './StartStep';

afterEach(() => {
  // Unmount while the host is still there: an open sign-in cancels itself on unmount.
  cleanup();
  __setApiOverride(null);
  __resetAgentClisForTests();
});

const report = (over: Partial<AgentCliReport> = {}): AgentCliReport => ({
  state: 'current',
  command: 'agent',
  installed: '1.0.0',
  latest: '1.0.0',
  minimum: '1.0.0',
  checkedAt: 1,
  signedIn: true,
  account: null,
  ...over,
});
const agent = (name: string, agentName: string, cli: AgentCliReport): ProviderEntry => ({
  name,
  agentName,
  ready: cli.signedIn === true,
  enabled: true,
  active: false,
  authKind: 'oauth',
  kind: 'builtin',
  keyName: `${name.toUpperCase().replace(/-/g, '_')}_API_KEY`,
  agentCli: cli,
});
const MISSING = report({ state: 'missing', installed: null, signedIn: undefined });

function host(providers: ReadonlyArray<ProviderEntry>): Array<[string, unknown]> {
  const calls: Array<[string, unknown]> = [];
  __setApiOverride({
    invoke: async (cmd: string, args: unknown) => {
      calls.push([cmd, args]);
      if (cmd === 'settings.providers') return providers;
      if (cmd === 'settings.providerCatalog') {
        return [
          { name: 'anthropic', kind: 'api' },
          { name: 'openai', kind: 'api' },
          { name: 'claude-code', kind: 'agent' },
        ];
      }
      if (cmd === 'onboarding.providerAuthKind') return 'api-key';
      if (cmd === 'agents.run') return { ok: true, message: 'Installed' };
      if (cmd === 'provider.login.start') return undefined;
      return [];
    },
    subscribe: () => () => undefined,
  } as never);
  return calls;
}

const claudeMissing = agent('claude-code', 'Claude Code', MISSING);
const codexMissing = agent('codex-agent', 'Codex', MISSING);
const freeMissing = agent('opencode', 'OpenCode', MISSING);
const nothingYet = [claudeMissing, codexMissing, freeMissing];

function renderStep(): { onDone: ReturnType<typeof vi.fn>; onSkip: ReturnType<typeof vi.fn> } {
  const onDone = vi.fn();
  const onSkip = vi.fn();
  render(<StartStep onDone={onDone} onSkip={onSkip} />);
  return { onDone, onSkip };
}

describe('StartStep', () => {
  it('asks how to start in words a person who never programmed knows', async () => {
    host(nothingYet);
    renderStep();

    expect(screen.getByRole('heading', { name: /Hi, I’m Moxxy/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Use my Claude or ChatGPT plan/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Start free/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'I have an API key' })).toBeTruthy();
    await waitFor(() => expect(document.body.textContent).not.toMatch(/\b(provider|CLI|npm|PATH|vault|OAuth|SDK)\b/i));
  });

  it('offers a plan already signed in on this computer, one press from the chat', async () => {
    const calls = host([agent('claude-code', 'Claude Code', report({ account: 'ana@example.com' })), codexMissing, freeMissing]);
    const { onDone } = renderStep();

    const row = await screen.findByRole('button', { name: /Continue with Claude/ });
    expect(row).toHaveTextContent('Signed in as ana@example.com');
    fireEvent.click(row);

    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1));
    expect(calls).toContainEqual(['onboarding.provisionProvider', { provider: 'claude-code' }]);
  });

  it('installs Claude for the person when it is not on this computer', async () => {
    const calls = host(nothingYet);
    renderStep();

    fireEvent.click(screen.getByRole('button', { name: /Use my Claude or ChatGPT plan/ }));
    fireEvent.click(await screen.findByRole('button', { name: /^Claude/ }));

    await waitFor(() => expect(calls).toContainEqual(['agents.run', { provider: 'claude-code', action: 'install' }]));
  });

  it('opens the sign-in at once for a plan that is installed but signed out', async () => {
    const calls = host([claudeMissing, agent('codex-agent', 'Codex', report({ signedIn: false })), freeMissing]);
    renderStep();

    fireEvent.click(screen.getByRole('button', { name: /Use my Claude or ChatGPT plan/ }));
    fireEvent.click(await screen.findByRole('button', { name: /^ChatGPT.*Sign in with your ChatGPT account/ }));

    await waitFor(() =>
      expect(calls.some(([cmd, args]) => cmd === 'provider.login.start' && (args as { provider: string }).provider === 'codex-agent')).toBe(true),
    );
  });

  it('goes back from the plan list to the question', async () => {
    host(nothingYet);
    renderStep();

    fireEvent.click(screen.getByRole('button', { name: /Use my Claude or ChatGPT plan/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Back' }));

    expect(screen.getByRole('button', { name: /Start free/ })).toBeTruthy();
  });

  it('starts free with no account', async () => {
    const calls = host([claudeMissing, codexMissing, agent('opencode', 'OpenCode', report())]);
    const { onDone } = renderStep();

    await waitFor(() => expect(screen.getByRole('button', { name: /Start free/ })).toHaveTextContent('No account needed.'));
    fireEvent.click(screen.getByRole('button', { name: /Start free/ }));

    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1));
    expect(calls).toContainEqual(['onboarding.provisionProvider', { provider: 'opencode' }]);
  });

  it('starts free before Moxxy knows anything about sign-ins, which the free model does not need', async () => {
    const calls = host([claudeMissing, codexMissing, agent('opencode', 'OpenCode', report({ signedIn: undefined }))]);
    const { onDone } = renderStep();

    await waitFor(() => expect(screen.getByRole('button', { name: /Start free/ })).toHaveTextContent('No account needed.'));
    expect(document.body.textContent).not.toMatch(/Free model account/);
    fireEvent.click(screen.getByRole('button', { name: /Start free/ }));

    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1));
    expect(calls).toContainEqual(['onboarding.provisionProvider', { provider: 'opencode' }]);
  });

  it('connects with an API key for the people who have one', async () => {
    const calls = host(nothingYet);
    const { onDone } = renderStep();

    fireEvent.click(screen.getByRole('button', { name: 'I have an API key' }));
    await screen.findByRole('option', { name: 'Anthropic' });
    fireEvent.change(screen.getByLabelText('API key'), { target: { value: 'sk-test' } });
    fireEvent.click(screen.getByRole('button', { name: 'Connect' }));

    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1));
    expect(calls).toContainEqual(['onboarding.saveProviderKey', { provider: 'anthropic', secret: 'sk-test' }]);
    expect(calls).toContainEqual(['onboarding.provisionProvider', { provider: 'anthropic' }]);
  });

  it('can be left for later', () => {
    host(nothingYet);
    const { onSkip } = renderStep();

    fireEvent.click(screen.getByRole('button', { name: 'Skip for now' }));

    expect(onSkip).toHaveBeenCalledTimes(1);
  });
});
