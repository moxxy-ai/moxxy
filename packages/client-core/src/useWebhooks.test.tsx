import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { __setApiOverride } from './transport.js';
import { useWebhooks } from './useWebhooks.js';
import type { MoxxyApi, WebhookSummary } from '@moxxy/desktop-ipc-contract';

function fakeApi(invoke: MoxxyApi['invoke']): MoxxyApi {
  return { invoke, subscribe: () => () => {} };
}

afterEach(() => __setApiOverride(null));

const sample: WebhookSummary = {
  id: 'wh-github',
  name: 'github-push',
  description: 'Fire on a push to main',
  enabled: true,
  url: null,
  localPath: '/webhook/wh-github',
  promptPreview: 'A push landed on main',
  model: null,
  fireCount: 3,
  lastFiredAt: 1_780_000_000_000,
  lastResult: 'ok',
  lastError: null,
  createdAt: 1_779_000_000_000,
};

describe('useWebhooks', () => {
  it('loads webhooks on mount', async () => {
    const invoke = vi.fn(async (cmd: string) => {
      if (cmd === 'webhooks.list') return [sample];
      throw new Error(`unexpected ${cmd}`);
    });
    __setApiOverride(fakeApi(invoke as unknown as MoxxyApi['invoke']));

    const { result } = renderHook(() => useWebhooks());
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.list).toEqual([sample]);
    expect(invoke).toHaveBeenCalledWith('webhooks.list');
  });

  it('refreshes after toggling an existing webhook', async () => {
    let enabled = true;
    const invoke = vi.fn(async (cmd: string, args?: unknown) => {
      if (cmd === 'webhooks.list') return [{ ...sample, enabled }];
      if (cmd === 'webhooks.setEnabled') {
        enabled = (args as { enabled: boolean }).enabled;
        return { ...sample, enabled };
      }
      throw new Error(`unexpected ${cmd}`);
    });
    __setApiOverride(fakeApi(invoke as unknown as MoxxyApi['invoke']));

    const { result } = renderHook(() => useWebhooks());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.setEnabled('wh-github', false);
    });

    expect(result.current.list[0]?.enabled).toBe(false);
    expect(invoke).toHaveBeenCalledWith('webhooks.setEnabled', {
      id: 'wh-github',
      enabled: false,
    });
  });

  it('removes a deleted webhook after the host confirms deletion', async () => {
    let deleted = false;
    const invoke = vi.fn(async (cmd: string) => {
      if (cmd === 'webhooks.list') return deleted ? [] : [sample];
      if (cmd === 'webhooks.delete') {
        deleted = true;
        return { deleted: true };
      }
      throw new Error(`unexpected ${cmd}`);
    });
    __setApiOverride(fakeApi(invoke as unknown as MoxxyApi['invoke']));

    const { result } = renderHook(() => useWebhooks());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.deleteWebhook('wh-github');
    });

    expect(result.current.list).toEqual([]);
    expect(invoke).toHaveBeenCalledWith('webhooks.delete', { id: 'wh-github' });
  });
});
