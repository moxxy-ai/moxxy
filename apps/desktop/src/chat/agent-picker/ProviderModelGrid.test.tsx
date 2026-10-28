import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { __setApiOverride } from '@moxxy/client-core';
import type { MoxxyApi, ProviderEntry } from '@moxxy/desktop-ipc-contract';
import type { AgentCliReport } from '@moxxy/sdk';
import { ProviderModelGrid } from './ProviderModelGrid';

afterEach(() => {
  __setApiOverride(null);
});

describe('ProviderModelGrid layout', () => {
  it('bounds long model lists by the viewport and scrolls inside the grid', () => {
    __setApiOverride({
      invoke: async () => [],
      subscribe: () => () => {},
    } as unknown as MoxxyApi);
    render(
      <ProviderModelGrid
        providers={[
          {
            name: 'openai',
            models: Array.from({ length: 20 }, (_, index) => ({
              id: `gpt-${index}`,
            })),
          },
        ]}
        activeProvider="openai"
        activeModel={null}
        onPick={() => {}}
      />,
    );

    const providers = screen.getByRole('listbox', { name: 'Providers' });
    const models = screen.getByRole('listbox', { name: 'Models' });
    const grid = providers.parentElement;

    expect(grid?.style.height).toBe('clamp(180px, 38dvh, 320px)');
    expect(models.style.minHeight).toBe('0px');
    expect(models.style.overflowY).toBe('auto');
    expect(models.style.maxHeight).toBe('');
  });

  it('automatically replaces the local seed catalog with exact live Ollama models', async () => {
    const invoke = vi.fn(async (command: string) => {
      if (command === 'settings.fetchProviderModels') {
        return [
          'gpt-oss:20b',
          'SpeakLeash/bielik-11b-v3.0-instruct:Q8_0',
          'glm-5:cloud',
        ];
      }
      throw new Error(`unexpected ${command}`);
    });
    __setApiOverride({ invoke, subscribe: () => () => {} } as unknown as MoxxyApi);
    const onPick = vi.fn();
    render(
      <ProviderModelGrid
        providers={[{
          name: 'local',
          supportsLiveModelDiscovery: true,
          models: [{ id: 'llama3.3' }, { id: 'qwen3' }],
        }]}
        activeProvider="local"
        activeModel={null}
        onPick={onPick}
      />,
    );

    expect(await screen.findByText('SpeakLeash/bielik-11b-v3.0-instruct:Q8_0')).toBeTruthy();
    expect(screen.getByText('gpt-oss:20b')).toBeTruthy();
    expect(screen.queryByText('llama3.3')).toBeNull();
    expect(screen.queryByText('qwen3')).toBeNull();
    expect(screen.queryByText('Default')).toBeNull();
    expect(screen.getByText('Cloud via Ollama')).toBeTruthy();
    expect(invoke).toHaveBeenCalledWith('settings.fetchProviderModels', { provider: 'local' });
    fireEvent.click(screen.getByText('SpeakLeash/bielik-11b-v3.0-instruct:Q8_0'));
    expect(onPick).toHaveBeenCalledWith(
      'local',
      'SpeakLeash/bielik-11b-v3.0-instruct:Q8_0',
    );
  });

  it('keeps the last successful model list when refresh temporarily fails', async () => {
    let calls = 0;
    const invoke = vi.fn(async (command: string) => {
      if (command !== 'settings.fetchProviderModels') throw new Error(`unexpected ${command}`);
      calls += 1;
      if (calls === 1) return ['SpeakLeash/bielik-11b-v3.0-instruct:Q8_0'];
      throw new Error('Ollama is not reachable at http://localhost:11434');
    });
    __setApiOverride({ invoke, subscribe: () => () => {} } as unknown as MoxxyApi);
    render(
      <ProviderModelGrid
        providers={[{
          name: 'local',
          supportsLiveModelDiscovery: true,
          models: [{ id: 'llama3.3' }],
        }]}
        activeProvider="local"
        activeModel={null}
        onPick={() => {}}
      />,
    );

    expect(await screen.findByText('SpeakLeash/bielik-11b-v3.0-instruct:Q8_0')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Refresh models' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/not reachable/i);
    expect(screen.getByText('SpeakLeash/bielik-11b-v3.0-instruct:Q8_0')).toBeTruthy();
    await waitFor(() => expect(invoke).toHaveBeenCalledTimes(2));
  });

  it('shows loading and an honest empty state', async () => {
    let finish: ((models: string[]) => void) | undefined;
    __setApiOverride({
      invoke: () => new Promise<string[]>((resolve) => {
        finish = resolve;
      }),
      subscribe: () => () => {},
    } as unknown as MoxxyApi);
    render(
      <ProviderModelGrid
        providers={[{ name: 'local', supportsLiveModelDiscovery: true, models: [] }]}
        activeProvider="local"
        activeModel={null}
        onPick={() => {}}
      />,
    );

    expect(await screen.findByText('Loading models…')).toBeTruthy();
    finish?.([]);
    expect(await screen.findByText(/no models are currently available/i)).toBeTruthy();
  });

  it('can retry after the first Ollama request fails', async () => {
    let calls = 0;
    __setApiOverride({
      invoke: async () => {
        calls += 1;
        if (calls === 1) throw new Error('Ollama is not reachable');
        return ['gpt-oss:20b'];
      },
      subscribe: () => () => {},
    } as unknown as MoxxyApi);
    render(
      <ProviderModelGrid
        providers={[{ name: 'local', supportsLiveModelDiscovery: true, models: [] }]}
        activeProvider="local"
        activeModel={null}
        onPick={() => {}}
      />,
    );

    expect(await screen.findByRole('alert')).toHaveTextContent(/not reachable/i);
    fireEvent.click(screen.getByRole('button', { name: 'Refresh models' }));
    expect(await screen.findByText('gpt-oss:20b')).toBeTruthy();
  });

  it('selects a custom model with the 200k context fallback when the user does not know its limit', async () => {
    __setApiOverride({ invoke: async () => [], subscribe: () => () => {} } as unknown as MoxxyApi);
    const onPick = vi.fn();
    render(
      <ProviderModelGrid
        providers={[{ name: 'openai', models: [{ id: 'gpt-6-luna' }] }]}
        activeProvider="openai"
        activeModel={null}
        onPick={onPick}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Custom model…' }));
    fireEvent.change(screen.getByLabelText('Custom model ID'), {
      target: { value: 'vendor/model-v2' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Use custom model' }));

    expect(onPick).toHaveBeenCalledWith('openai', 'vendor/model-v2', 200_000);
  });

  it('uses the context window typed by a user who knows the custom model limit', () => {
    __setApiOverride({ invoke: async () => [], subscribe: () => () => {} } as unknown as MoxxyApi);
    const onPick = vi.fn();
    render(
      <ProviderModelGrid
        providers={[{ name: 'openai', models: [{ id: 'gpt-6-luna' }] }]}
        activeProvider="openai"
        activeModel={null}
        onPick={onPick}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Custom model…' }));
    fireEvent.change(screen.getByLabelText('Custom model ID'), {
      target: { value: 'vendor/model-v2' },
    });
    fireEvent.click(screen.getByLabelText('I know the context window'));
    fireEvent.change(screen.getByLabelText('Context window (tokens)'), {
      target: { value: '64000' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Use custom model' }));

    expect(onPick).toHaveBeenCalledWith('openai', 'vendor/model-v2', 64_000);
  });
});

describe('ProviderModelGrid providers', () => {
  const entry = (over: Partial<ProviderEntry> & { name: string }): ProviderEntry => ({
    ready: true,
    enabled: true,
    active: false,
    authKind: 'api-key',
    kind: 'builtin',
    keyName: `${over.name.toUpperCase()}_API_KEY`,
    ...over,
  });
  const signedIn: AgentCliReport = {
    state: 'current',
    command: 'opencode',
    installed: '1.19.3',
    latest: '1.19.3',
    minimum: '1.0.0',
    checkedAt: 1,
    signedIn: true,
  };
  const catalog = [
    { name: 'opencode', agentName: 'OpenCode', models: [{ id: 'opencode/big-pickle' }] },
    { name: 'claude-code', agentName: 'Claude', models: [{ id: 'claude-opus-5-5' }] },
    { name: 'codex-agent', agentName: 'Codex', models: [{ id: 'gpt-6-sol' }] },
    { name: 'anthropic', models: [{ id: 'claude-opus-5-5' }] },
    { name: 'openai', models: [{ id: 'gpt-6-luna' }] },
    { name: 'local', models: [{ id: 'llama3.3' }] },
    { name: 'xai', models: [{ id: 'grok-5' }] },
  ];
  const settings = [
    entry({ name: 'opencode', agentName: 'OpenCode', authKind: 'oauth', active: true, agentCli: signedIn }),
    entry({ name: 'claude-code', agentName: 'Claude', authKind: 'oauth', agentCli: { ...signedIn, command: 'claude' } }),
    entry({ name: 'codex-agent', agentName: 'Codex', authKind: 'oauth', agentCli: { ...signedIn, command: 'codex', signedIn: false } }),
    entry({ name: 'anthropic', ready: false }),
    entry({ name: 'openai', authKind: 'oauth' }),
    entry({ name: 'local', connected: false }),
    entry({ name: 'xai', ready: false }),
  ];

  function renderGrid(invoke: (command: string, args?: unknown) => Promise<unknown>) {
    __setApiOverride({ invoke, subscribe: () => () => {} } as unknown as MoxxyApi);
    render(
      <ProviderModelGrid
        workspaceId="ws-1"
        providers={catalog}
        activeProvider="opencode"
        activeModel={null}
        onPick={() => {}}
      />,
    );
  }

  it('lists only the providers connected in Settings, coding agents apart from model providers', async () => {
    const invoke = vi.fn(async (command: string) => {
      if (command === 'settings.providers') return settings;
      return [];
    });
    renderGrid(invoke);

    const agents = await screen.findByRole('group', { name: 'SDK · OAuth login' });
    const models = screen.getByRole('group', { name: 'API · API key login' });
    // Each heading is only the kind's name: no line explaining it.
    expect(within(agents).getByRole('presentation').textContent).toBe('SDK · OAuth login');
    expect(within(models).getByRole('presentation').textContent).toBe('API · API key login');
    expect(within(agents).getAllByRole('option').map((o) => o.textContent)).toEqual(['opencode', 'claude-code']);
    expect(within(models).getAllByRole('option').map((o) => o.textContent)).toEqual(['openai']);
    expect(screen.queryByRole('option', { name: 'anthropic' })).toBeNull();
    expect(screen.queryByRole('option', { name: 'local' })).toBeNull();
    expect(invoke).toHaveBeenCalledWith('settings.providers', { workspaceId: 'ws-1' });
  });

  it('shows only the running provider until Settings answers', () => {
    renderGrid(() => new Promise(() => {}));

    expect(screen.getAllByRole('option', { name: /./ }).filter((o) => o.closest('[aria-label="Providers"]')).map((o) => o.textContent)).toEqual(['opencode']);
  });

  it('keeps every provider when Settings cannot answer, rather than none', async () => {
    renderGrid(async (command) => {
      if (command === 'settings.providers') throw new Error('runner not attached');
      return [];
    });

    const models = await screen.findByRole('group', { name: 'API · API key login' });
    expect(within(models).getAllByRole('option')).toHaveLength(4);
  });
});
