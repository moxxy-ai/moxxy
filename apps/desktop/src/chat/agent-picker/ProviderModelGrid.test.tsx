import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { __setApiOverride } from '@moxxy/client-core';
import type { MoxxyApi } from '@moxxy/desktop-ipc-contract';
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
            name: 'openai-codex',
            models: Array.from({ length: 20 }, (_, index) => ({
              id: `gpt-${index}`,
            })),
          },
        ]}
        activeProvider="openai-codex"
        activeModel={null}
        onPick={() => {}}
      />,
    );

    const providers = screen.getByRole('listbox', { name: 'Providers' });
    const models = screen.getByRole('listbox', { name: 'Models' });
    const grid = providers.parentElement;

    expect(grid?.style.height).toBe('clamp(180px, 38dvh, 320px)');
    expect(models.style.minHeight).toBe('0');
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
});
