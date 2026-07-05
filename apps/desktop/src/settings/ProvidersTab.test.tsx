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

import { describe, expect, it, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { __setApiOverride } from '@moxxy/client-core';
import type { ProviderEntry } from '@moxxy/desktop-ipc-contract';
import { ProvidersTab } from './ProvidersTab';

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
  name: 'openai-codex',
  ready: false,
  enabled: true,
  active: false,
  authKind: 'oauth',
  kind: 'builtin',
  keyName: 'OPENAI_CODEX_API_KEY',
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
} {
  const onToggle = vi.fn(() => Promise.resolve());
  const onConfigure = vi.fn(() => Promise.resolve());
  const onSetKey = vi.fn(() => Promise.resolve());
  render(
    <ProvidersTab
      providers={[anthropic, codex, zai]}
      onToggle={onToggle}
      onConfigure={onConfigure}
      onSetKey={onSetKey}
      onRefresh={() => Promise.resolve()}
      {...overrides}
    />,
  );
  return { onToggle, onConfigure, onSetKey };
}

describe('ProvidersTab', () => {
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

  it('shows the reasoning selector only for providers that support it', () => {
    // anthropic carries no supportsReasoning flag → no selector.
    renderTab();
    fireEvent.click(screen.getByRole('button', { name: /configure anthropic/i }));
    expect(screen.queryByTestId('provider-reasoning-select')).toBeNull();
  });

  it('applies the reasoning effort live via settings.setReasoning', async () => {
    const invoke = vi.fn(() => Promise.resolve());
    __setApiOverride({ invoke, subscribe: vi.fn(() => () => {}) } as never);
    const reasoner: ProviderEntry = { ...anthropic, name: 'opus', active: false, supportsReasoning: true };
    renderTab({ providers: [reasoner] });
    fireEvent.click(screen.getByRole('button', { name: /configure opus/i }));
    const select = screen.getByTestId('provider-reasoning-select');
    fireEvent.change(select, { target: { value: 'high' } });
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith('settings.setReasoning', { effort: 'high' }),
    );
    // 'off' clears it through the same path.
    fireEvent.change(select, { target: { value: 'off' } });
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith('settings.setReasoning', { effort: 'off' }),
    );
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

  it('offers a real sign-in (not a key form) for OAuth providers', () => {
    // The OAuthSignIn flow subscribes to provider.login.* on mount, so the
    // configure sheet needs a transport even though the buttons aren't clicked.
    __setApiOverride({ invoke: vi.fn(() => Promise.resolve()), subscribe: vi.fn(() => () => {}) } as never);
    renderTab();
    fireEvent.click(screen.getByRole('button', { name: /configure openai-codex/i }));
    expect(screen.getByText(/signs in with OAuth/i)).toBeTruthy();
    expect(screen.queryByTestId('provider-key-input')).toBeNull();
    // The dead "run moxxy login in a terminal" hint is gone — there's a button.
    expect(screen.getByRole('button', { name: /sign in with openai-codex/i })).toBeTruthy();
  });
});
