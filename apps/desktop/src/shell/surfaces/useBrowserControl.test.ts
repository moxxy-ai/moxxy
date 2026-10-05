import { afterEach, describe, expect, it } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import { __setApiOverride, chatStore } from '@moxxy/client-core';
import type { BrowserControlState } from '@moxxy/desktop-ipc-contract';
import { browserControlMode, useBrowserControl } from './useBrowserControl.js';

const agent = (turnId: string | null): BrowserControlState => ({ driver: 'agent', turnId });
const user = (turnId: string | null): BrowserControlState => ({ driver: 'user', turnId });

describe('browserControlMode', () => {
  it('shows the agent’s controls only while the turn that used the browser runs', () => {
    expect(browserControlMode(agent('T1'), 'T1')).toBe('agent');
    expect(browserControlMode(agent('T1'), null)).toBeNull();
    expect(browserControlMode(agent('T1'), 'T2')).toBeNull();
    expect(browserControlMode(agent(null), 'T1')).toBeNull();
  });

  it('shows the person that they have the browser while that turn waits on them', () => {
    expect(browserControlMode(user('T1'), 'T1')).toBe('user');
    expect(browserControlMode(user('T1'), null)).toBeNull();
  });
});

function installApi() {
  const calls: Array<{ channel: string; args: unknown }> = [];
  __setApiOverride({
    invoke: ((channel: string, args: unknown) => {
      calls.push({ channel, args });
      return Promise.resolve(undefined);
    }) as never,
    subscribe: (() => () => undefined) as never,
  } as never);
  return calls;
}

afterEach(() => {
  cleanup();
  __setApiOverride(null as never);
  chatStore.drop('w1');
});

describe('useBrowserControl', () => {
  it('follows the workspace’s running turn', () => {
    installApi();
    const { result } = renderHook(() => useBrowserControl('w1', agent('T1')));
    expect(result.current.mode).toBeNull();

    act(() => chatStore.dispatch('w1', { type: 'send_started', turnId: 'T1' } as never));

    expect(result.current.mode).toBe('agent');
  });

  it('takes over and resumes through main, where the agent’s actions are held', async () => {
    const calls = installApi();
    const { result } = renderHook(() => useBrowserControl('w1', agent('T1')));

    await act(() => result.current.takeOver());
    await act(() => result.current.resume());

    expect(calls).toEqual([
      { channel: 'browser.control', args: { command: 'takeover' } },
      { channel: 'browser.control', args: { command: 'resume' } },
    ]);
  });

  it('stops by taking the browser back and ending the running turn', async () => {
    const calls = installApi();
    act(() => chatStore.dispatch('w1', { type: 'send_started', turnId: 'T1' } as never));
    const { result } = renderHook(() => useBrowserControl('w1', agent('T1')));

    await act(() => result.current.stop());

    expect(calls).toEqual([
      { channel: 'browser.control', args: { command: 'takeover' } },
      { channel: 'session.abortTurn', args: { workspaceId: 'w1', turnId: 'T1' } },
    ]);
  });
});
