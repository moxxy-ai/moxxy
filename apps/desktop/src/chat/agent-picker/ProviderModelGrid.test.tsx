import { afterEach, describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
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
});
