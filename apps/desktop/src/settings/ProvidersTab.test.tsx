/**
 * ProvidersTab interactions:
 *   1. The enable/disable Switch calls onToggle with the inverted state,
 *      and is disabled (control-level) for the ACTIVE provider — mirroring
 *      the runner's refusal to disable it.
 *   2. Configure opens the sheet; "Save key" routes through onSetKey with
 *      the row's canonical vault key name.
 *   3. Admin rows expose endpoint fields; "Save configuration" sends only
 *      the changed fields. OAuth rows get a login hint instead of a key form.
 */

import { describe, expect, it, afterEach, beforeEach, vi } from 'vitest';
import { act, render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { __setApiOverride } from '@moxxy/client-core';
import { assertDefined } from '@moxxy/sdk';
import type { ProviderEntry } from '@moxxy/desktop-ipc-contract';
import { ProvidersTab } from './ProvidersTab';

// The agent rows follow installs through the IPC surface; a silent one for the rest.
beforeEach(() => {
  __setApiOverride({ invoke: async () => undefined, subscribe: () => () => undefined } as never);
});

afterEach(() => {
  __setApiOverride(null);
});

const anthropic: ProviderEntry = {
  name: 'anthropic',
  ready: true,
  enabled: true,
  active: true,
  authKind: 'api-key',
  kind: 'builtin',
  keyName: 'ANTHROPIC_API_KEY',
};

const codex: ProviderEntry = {
  name: 'codex-agent',
  ready: false,
  enabled: true,
  active: false,
  authKind: 'oauth',
  kind: 'builtin',
  keyName: 'CODEX_AGENT_API_KEY',
};

const zai: ProviderEntry = {
  name: 'zai',
  ready: false,
  enabled: false,
  active: false,
  authKind: 'api-key',
  kind: 'admin',
  keyName: 'ZAI_API_KEY',
  baseURL: 'https://api.z.ai/v4',
  defaultModel: 'glm-4',
  modelIds: ['glm-4', 'glm-4-air'],
};

function renderTab(overrides?: Partial<Parameters<typeof ProvidersTab>[0]>): {
  onToggle: ReturnType<typeof vi.fn>;
  onConfigure: ReturnType<typeof vi.fn>;
  onSetKey: ReturnType<typeof vi.fn>;
  onActivate: ReturnType<typeof vi.fn>;
} {
  const onToggle = vi.fn(() => Promise.resolve());
  const onConfigure = vi.fn(() => Promise.resolve());
  const onSetKey = vi.fn(() => Promise.resolve());
  const onActivate = vi.fn(() => Promise.resolve());
  render(
    <ProvidersTab
      providers={[anthropic, codex, zai]}
      onToggle={onToggle}
      onConfigure={onConfigure}
      onSetKey={onSetKey}
      onActivate={onActivate}
      onRefresh={() => Promise.resolve()}
      {...overrides}
    />,
  );
  return { onToggle, onConfigure, onSetKey, onActivate };
}

describe('ProvidersTab', () => {
  it('places the default model above the providers, and keeps it when there is none to list', () => {
    const defaultModel = <div data-testid="default-model-slot" />;
    const { unmount } = render(
      <ProvidersTab
        providers={[anthropic]}
        onToggle={() => Promise.resolve()}
        onConfigure={() => Promise.resolve()}
        onSetKey={() => Promise.resolve()}
        onActivate={() => Promise.resolve()}
        onRefresh={() => Promise.resolve()}
        defaultModel={defaultModel}
      />,
    );
    const slot = screen.getByTestId('default-model-slot');
    const row = screen.getByTestId('provider-row-anthropic');
    expect(slot.compareDocumentPosition(row) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    unmount();

    render(
      <ProvidersTab
        providers={[]}
        onToggle={() => Promise.resolve()}
        onConfigure={() => Promise.resolve()}
        onSetKey={() => Promise.resolve()}
        onActivate={() => Promise.resolve()}
        onRefresh={() => Promise.resolve()}
        defaultModel={defaultModel}
      />,
    );
    expect(screen.getByTestId('default-model-slot')).toBeInTheDocument();
  });

  it('toggles a provider via the switch; the ACTIVE provider switch is disabled', () => {
    const { onToggle } = renderTab();

    // zai is disabled → switch turns it ON.
    fireEvent.click(screen.getByRole('switch', { name: /enable zai/i }));
    expect(onToggle).toHaveBeenCalledWith('zai', true);

    // anthropic is the active provider — its disable switch is inert.
    const activeSwitch = screen.getByRole('switch', { name: /disable anthropic/i });
    expect((activeSwitch as HTMLButtonElement).disabled).toBe(true);
  });

  it('saves an API key through the configure sheet under the row keyName', async () => {
    const { onSetKey } = renderTab();
    fireEvent.click(screen.getByRole('button', { name: /configure anthropic/i }));
    fireEvent.change(screen.getByTestId('provider-key-input'), { target: { value: 'sk-abc' } });
    fireEvent.click(screen.getByRole('button', { name: /save key/i }));
    await waitFor(() => expect(onSetKey).toHaveBeenCalledWith('ANTHROPIC_API_KEY', 'sk-abc'));
  });

  it('sends only the changed endpoint fields for an admin provider', async () => {
    const { onConfigure } = renderTab();
    fireEvent.click(screen.getByRole('button', { name: /configure zai/i }));
    fireEvent.change(screen.getByTestId('provider-baseurl-input'), {
      target: { value: 'https://api.z.ai/v5' },
    });
    fireEvent.click(screen.getByRole('button', { name: /save configuration/i }));
    await waitFor(() =>
      expect(onConfigure).toHaveBeenCalledWith('zai', { baseURL: 'https://api.z.ai/v5' }),
    );
  });

  it('leaves reasoning effort to the model picker', () => {
    const reasoner: ProviderEntry = { ...anthropic, name: 'opus', active: false, supportsReasoning: true };
    renderTab({ providers: [reasoner] });
    fireEvent.click(screen.getByRole('button', { name: /configure opus/i }));
    expect(screen.queryByText('Reasoning effort')).toBeNull();
  });

  it('shows a "no key needed" note (not a key form) for the local provider', () => {
    // The runner reports the local provider's authKind as 'api-key' (its def
    // carries a placeholder key for the OpenAI SDK), but there is no real key
    // to enter — the sheet must not prompt for one.
    const local: ProviderEntry = {
      name: 'local',
      ready: false,
      enabled: true,
      active: false,
      authKind: 'api-key',
      kind: 'builtin',
      keyName: 'LOCAL_API_KEY',
    };
    renderTab({ providers: [local] });
    fireEvent.click(screen.getByRole('button', { name: /configure local/i }));
    expect(screen.getByTestId('provider-no-key-note')).toBeTruthy();
    expect(screen.queryByTestId('provider-key-input')).toBeNull();
    // …and not the misleading "only the key is configurable" built-in note.
    expect(screen.queryByText(/only the key is configurable/i)).toBeNull();
  });

  it('distinguishes a configured local provider from a reachable Ollama server', () => {
    const disconnected = {
      name: 'local',
      ready: true,
      connected: false,
      enabled: true,
      active: true,
      authKind: 'api-key',
      kind: 'builtin',
      keyName: 'LOCAL_API_KEY',
    } as ProviderEntry & { connected: boolean };
    const view = renderTab({ providers: [disconnected] });
    expect(screen.getByText(/configured · ollama is not reachable/i)).toBeTruthy();
    expect(screen.getByText('Unavailable')).toBeTruthy();

    view.onToggle.mockClear();
  });

  it('reports Connected only when the local model server answers', () => {
    const connected = {
      name: 'local',
      ready: true,
      connected: true,
      enabled: true,
      active: true,
      authKind: 'api-key',
      kind: 'builtin',
      keyName: 'LOCAL_API_KEY',
    } as ProviderEntry & { connected: boolean };
    renderTab({ providers: [connected] });
    expect(screen.getByText(/connected · ollama is available/i)).toBeTruthy();
    expect(screen.getByText('Connected')).toBeTruthy();
  });

  it('offers a real sign-in (not a key form) for OAuth providers', () => {
    // The OAuthSignIn flow subscribes to provider.login.* on mount, so the
    // configure sheet needs a transport even though the buttons aren't clicked.
    __setApiOverride({ invoke: vi.fn(() => Promise.resolve()), subscribe: vi.fn(() => () => {}) } as never);
    renderTab();
    fireEvent.click(screen.getByRole('button', { name: /configure codex-agent/i }));
    expect(screen.getByText(/signs in with OAuth/i)).toBeTruthy();
    expect(screen.queryByTestId('provider-key-input')).toBeNull();
    // The dead "run moxxy login in a terminal" hint is gone — there's a button.
    expect(screen.getByRole('button', { name: /sign in with codex-agent/i })).toBeTruthy();
  });

  it('activates the OAuth provider before reporting the settings sign-in complete', async () => {
    const handlers = new Map<string, (payload: unknown) => void>();
    const invoke = vi.fn(() => Promise.resolve());
    __setApiOverride({
      invoke,
      subscribe: (event: string, handler: (payload: unknown) => void) => {
        handlers.set(event, handler);
        return () => handlers.delete(event);
      },
    } as never);
    vi.spyOn(crypto, 'randomUUID').mockReturnValue('settings-login' as `${string}-${string}-${string}-${string}-${string}`);
    const { onActivate } = renderTab({ providers: [codex] });
    fireEvent.click(screen.getByRole('button', { name: /configure codex-agent/i }));
    fireEvent.click(screen.getByRole('button', { name: /sign in with codex-agent/i }));
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('provider.login.start', {
      loginId: 'settings-login',
      provider: 'codex-agent',
    }));

    handlers.get('provider.login.done')?.({ loginId: 'settings-login', code: 0 });

    await waitFor(() => expect(onActivate).toHaveBeenCalledWith('codex-agent'));
  });
});

describe('ProvidersTab — agent connections', () => {
  const opencode = (agentCli: ProviderEntry['agentCli']): ProviderEntry => ({
    name: 'opencode',
    agentName: 'OpenCode',
    ready: false,
    enabled: true,
    active: false,
    authKind: 'oauth',
    kind: 'builtin',
    keyName: 'OPENCODE_API_KEY',
    ...(agentCli ? { agentCli } : {}),
  });
  const missing = { state: 'missing', command: 'opencode', installed: null, latest: '1.19.2', minimum: '1.19.0', checkedAt: 1 } as const;

  function host(): { calls: Array<[string, unknown]>; finish: (r: { ok: boolean; message: string }) => void; progress: (p: unknown) => void } {
    const calls: Array<[string, unknown]> = [];
    let finish: (r: { ok: boolean; message: string }) => void = () => undefined;
    let progress: (p: unknown) => void = () => undefined;
    __setApiOverride({
      invoke: async (cmd: string, args: unknown) => {
        calls.push([cmd, args]);
        if (cmd === 'agents.run') return new Promise((resolve) => (finish = resolve));
        return undefined;
      },
      subscribe: (event: string, fn: (p: unknown) => void) => {
        if (event === 'agents.progress') progress = fn;
        return () => undefined;
      },
    } as never);
    return { calls, finish: (r) => finish(r), progress: (p) => act(() => progress(p)) };
  }

  it('installs a missing agent with a progress bar, by the agent’s name', async () => {
    const h = host();
    renderTab({ providers: [opencode(missing)] });

    const row = screen.getByTestId('agent-row-opencode');
    expect(row).toHaveTextContent('OpenCode');
    expect(row).toHaveTextContent('Not installed');
    fireEvent.click(screen.getByRole('button', { name: 'Install OpenCode' }));
    await waitFor(() => expect(h.calls).toContainEqual(['agents.run', { provider: 'opencode', action: 'install' }]));
    h.progress({ provider: 'opencode', action: 'install', line: '#### 40.0%', fraction: 0.4 });

    const bar = screen.getByRole('progressbar', { name: 'Installing OpenCode' });
    expect(bar).toHaveAttribute('aria-valuenow', '40');
    await act(async () => h.finish({ ok: false, message: 'curl: (6) Could not resolve host' }));
    expect(screen.getByTestId('agent-row-opencode')).toHaveTextContent('curl: (6) Could not resolve host');
    expect(screen.getByRole('button', { name: 'Install OpenCode' })).toHaveTextContent('Try again');
  });

  it('checks for updates from the row menu', async () => {
    const h = host();
    renderTab({ providers: [opencode({ ...missing, state: 'current', installed: '1.19.2', signedIn: true, account: 'OpenCode Zen' })] });

    expect(screen.getByTestId('agent-row-opencode')).toHaveTextContent('OpenCode Zen · OpenCode 1.19.2');
    fireEvent.click(screen.getByRole('button', { name: 'More for OpenCode' }));
    fireEvent.click(screen.getByRole('menuitem', { name: /check for updates/i }));

    await waitFor(() => expect(h.calls).toContainEqual(['agents.check', undefined]));
  });

  it("says the agent's state beside its name, leaving the line under it to what it is doing", () => {
    host();
    renderTab({ providers: [opencode({ ...missing, state: 'update-available', installed: '1.19.0', latest: '1.19.2', signedIn: true, account: 'OpenCode Zen' })] });

    const title = screen.getByTestId('agent-row-opencode').querySelector('[data-row-title]');
    assertDefined(title, 'the row has a title line');
    expect(title).toHaveTextContent('OpenCode');
    expect(title).toHaveTextContent('Update available');
    expect(title).not.toHaveTextContent('1.19.2 is out');
  });

  it('keeps other providers in the plain list', () => {
    host();
    renderTab({ providers: [anthropic, opencode(missing)] });

    expect(screen.getByTestId('provider-row-anthropic')).toBeInTheDocument();
    expect(screen.queryByTestId('provider-row-opencode')).toBeNull();
  });

  it('splits the agents from the providers Moxxy calls itself, each under its own heading', () => {
    host();
    renderTab({ providers: [anthropic, codex, opencode(missing)] });

    const agents = screen.getByRole('region', { name: 'SDK agents' });
    const models = screen.getByRole('region', { name: 'API models' });
    // Each kind says what it is, in plain words.
    expect(agents).toHaveTextContent('An agent app installed on this computer does the work, on its own sign-in.');
    expect(models).toHaveTextContent('Moxxy does the work and calls the model through its API, with an API key or a model on this computer.');
    expect(within(agents).getByTestId('agent-row-opencode')).toBeInTheDocument();
    expect(within(agents).queryByTestId('provider-row-anthropic')).toBeNull();
    expect(within(models).getByTestId('provider-row-anthropic')).toBeInTheDocument();
    expect(within(models).getByTestId('provider-row-codex-agent')).toBeInTheDocument();
    expect(agents).toHaveTextContent('1');
    expect(models).toHaveTextContent('2');
    expect(agents.compareDocumentPosition(models) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('shows no agents heading when no agent connection is known', () => {
    host();
    renderTab({ providers: [anthropic] });

    expect(screen.queryByRole('region', { name: 'SDK agents' })).toBeNull();
    expect(screen.getByRole('region', { name: 'API models' })).toBeInTheDocument();
  });
});
