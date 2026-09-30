import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ChatStoreBridge, ConnectionBridge, __setApiOverride } from '@moxxy/client-core';
import type { ChannelEntry, ChannelRunMode, ChannelRuntimeStatus } from '@moxxy/desktop-ipc-contract';
import type { MoxxyEvent } from '@moxxy/sdk';
import { ChannelsSurface } from './ChannelsSurface';

// The transcript virtualizer measures a real layout jsdom does not have; render
// its rows flat so the conversation is visible to the test.
vi.mock('react-virtuoso', async () => {
  const React = await import('react');
  return {
    Virtuoso: React.forwardRef(function FlatVirtuoso(
      props: {
        readonly data?: ReadonlyArray<unknown>;
        readonly itemContent?: (index: number, item: unknown) => React.ReactNode;
      },
      ref: React.Ref<unknown>,
    ) {
      React.useImperativeHandle(ref, () => ({ scrollToIndex: () => undefined }));
      return React.createElement(
        'div',
        null,
        ...(props.data ?? []).map((item, index) =>
          React.createElement(React.Fragment, { key: index }, props.itemContent?.(index, item)),
        ),
      );
    }),
  };
});

afterEach(() => {
  cleanup();
  __setApiOverride(null);
});

const CHAT_ID = 'moxxy-channel-discord';

const discord = (status: Partial<ChannelRuntimeStatus> = {}): ChannelEntry => ({
  descriptor: {
    id: 'discord',
    name: 'Discord',
    description: '',
    configFields: [],
    hasWebhookUrl: false,
    supportsModel: true,
    supportsBackground: true,
  },
  status: { id: 'discord', configured: true, running: true, runMode: 'manual', ...status },
});

const said = (seq: number, type: 'user_prompt' | 'assistant_message', text: string): MoxxyEvent =>
  ({
    id: `e${seq}`,
    seq,
    ts: seq,
    sessionId: CHAT_ID,
    turnId: 't1',
    source: type === 'user_prompt' ? 'user' : 'assistant',
    type,
    ...(type === 'user_prompt' ? { text } : { content: text, stopReason: 'end_turn' }),
  }) as MoxxyEvent;

// Fake IPC transport — the renderer ↔ main boundary — over a host whose
// Discord bot runner is attached and holds a short conversation.
function installHost(entry: ChannelEntry = discord()) {
  let runMode: ChannelRunMode = entry.status.runMode ?? 'manual';
  const invoke = vi.fn(async (cmd: string, args?: unknown) => {
    if (cmd === 'channels.list') return [{ ...entry, status: { ...entry.status, runMode } }];
    if (cmd === 'channels.setRunMode') {
      runMode = (args as { mode: ChannelRunMode }).mode;
      return { ...entry.status, runMode };
    }
    if (cmd === 'channels.openChat') return { workspaceId: CHAT_ID };
    if (cmd === 'channels.setModel') return { ...entry.status, runMode, model: (args as { model: string }).model };
    if (cmd === 'connection.snapshotAll') {
      return [{ workspaceId: CHAT_ID, phase: { phase: 'connected', socket: 's', sessionId: CHAT_ID, activeProvider: 'p', activeMode: null }, cliPath: null, attempts: 0, log: [] }];
    }
    if (cmd === 'chat.loadHistory') {
      return { events: [said(0, 'user_prompt', 'Cześć'), said(1, 'assistant_message', 'W czym mogę pomóc?')], prevCursor: null };
    }
    if (cmd === 'session.activeTurn') return { turnId: null };
    if (cmd === 'session.info') {
      return {
        activeProvider: 'p',
        activeMode: 'default',
        providers: [{ name: 'p', models: [{ id: 'm', contextWindow: 200_000 }] }],
        modes: [{ name: 'default' }],
        skills: [],
        tools: [],
      };
    }
    if (cmd === 'session.runTurn') return { turnId: 't2' };
    if (cmd === 'browser.listTabs') return { tabs: [], activeTabId: null };
    return undefined;
  });
  const listeners = new Map<string, Set<(payload: unknown) => void>>();
  const subscribe = (channel: string, fn: (payload: unknown) => void) => {
    const set = listeners.get(channel) ?? new Set();
    set.add(fn);
    listeners.set(channel, set);
    return () => set.delete(fn);
  };
  __setApiOverride({ invoke, subscribe } as never);
  return Object.assign(invoke, {
    emit: (channel: string, payload: unknown) => {
      for (const fn of listeners.get(channel) ?? []) fn(payload);
    },
  });
}

function renderSurface() {
  return render(
    <>
      <ConnectionBridge />
      <ChatStoreBridge />
      <ChannelsSurface selected="discord" />
    </>,
  );
}

describe('ChannelsSurface', () => {
  it('opens a configured channel as a live chat you can write in', async () => {
    const invoke = installHost();
    renderSurface();

    expect(await screen.findByText('Cześć')).toBeTruthy();
    expect(await screen.findByText('W czym mogę pomóc?')).toBeTruthy();
    expect(invoke).toHaveBeenCalledWith('channels.openChat', { channelId: 'discord' });

    const composer = await screen.findByTestId('composer-input');
    await waitFor(() => expect((composer as HTMLTextAreaElement).disabled).toBe(false));
    fireEvent.change(composer, { target: { value: 'hej z aplikacji' } });
    fireEvent.keyDown(composer, { key: 'Enter' });

    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith('session.runTurn', expect.objectContaining({ workspaceId: CHAT_ID, prompt: 'hej z aplikacji' })),
    );
  });

  it("shows the bot's model in the chat and saves a model picked there as the bot's model", async () => {
    const invoke = installHost();
    renderSurface();
    await screen.findByText('Cześć');

    // The host follows the bot's own model (its /model, or Setup) into this chat.
    act(() => invoke.emit('session.model.changed', { workspaceId: CHAT_ID, model: 'm' }));
    const agent = await screen.findByRole('button', { name: /model m/i });

    fireEvent.click(agent);
    // "Default" of a provider is its first model for a bot, which always names one.
    fireEvent.click(await screen.findByRole('option', { name: /Default/ }));

    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith('channels.setModel', { channelId: 'discord', model: 'p::m' }),
    );
    expect(invoke).not.toHaveBeenCalledWith('session.setModel', expect.anything());
  });

  it('opens a channel that is not set up yet on its setup page', async () => {
    const invoke = installHost(discord({ configured: false, running: false }));
    renderSurface();

    expect(await screen.findByRole('radio', { name: /Manual/u })).toBeTruthy();
    expect(invoke).not.toHaveBeenCalledWith('channels.openChat', expect.anything());
  });

  it('keeps the run mode you pick selected', async () => {
    const invoke = installHost();
    renderSurface();

    await screen.findByTestId('composer-input');
    fireEvent.click(screen.getByRole('button', { name: /Setup/u }));
    fireEvent.click(await screen.findByRole('radio', { name: /With the app/u }));

    await waitFor(() => expect(invoke).toHaveBeenCalledWith('channels.setRunMode', { channelId: 'discord', mode: 'app' }));
    await waitFor(() => expect((screen.getByRole('radio', { name: /With the app/u }) as HTMLInputElement).checked).toBe(true));
    expect((screen.getByRole('radio', { name: /Manual/u }) as HTMLInputElement).checked).toBe(false);
  });

  it('shows the bot’s browser, terminal and files beside its chat', async () => {
    installHost();
    renderSurface();

    await screen.findByTestId('composer-input');

    expect(screen.getByTestId('bench-open-browser')).toBeTruthy();
    expect(screen.getByTestId('bench-open-terminal')).toBeTruthy();
  });

  it('opens the browser when the bot’s agent starts using it', async () => {
    const host = installHost();
    renderSurface();
    await screen.findByTestId('composer-input');

    act(() =>
      host.emit('runner.event', {
        workspaceId: CHAT_ID,
        event: {
          id: 'e9',
          seq: 9,
          ts: 9,
          sessionId: CHAT_ID,
          turnId: 't3',
          source: 'assistant',
          type: 'tool_call_requested',
          callId: 'c1',
          name: 'browser_session',
          input: { action: 'navigate', url: 'https://youtube.com' },
        },
      }),
    );

    expect((await screen.findByTestId('bench-tab-browser')).getAttribute('aria-selected')).toBe('true');
  });

  it('lets you stop the bot’s agent while it works on a Discord request', async () => {
    const host = installHost();
    renderSurface();
    await screen.findByTestId('composer-input');

    act(() => host.emit('runner.turn.started', { workspaceId: CHAT_ID, turnId: 'bot-turn', visibility: 'foreground' }));
    fireEvent.click(await screen.findByTestId('composer-abort'));

    await waitFor(() =>
      expect(host).toHaveBeenCalledWith('session.abortTurn', { workspaceId: CHAT_ID, turnId: 'bot-turn' }),
    );
    act(() => host.emit('runner.turn.complete', { workspaceId: CHAT_ID, turnId: 'bot-turn', error: null }));
    expect(await screen.findByTestId('composer-send')).toBeTruthy();
  });
});

