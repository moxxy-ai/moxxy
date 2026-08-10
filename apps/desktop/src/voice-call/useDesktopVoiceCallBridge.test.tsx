import { StrictMode, type ReactNode } from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { UseVoiceCall } from '@moxxy/client-core';
import type {
  DesktopVoiceCallBridgeMessage,
  DesktopVoiceCallBridgePort,
} from './desktop-voice-call-bridge';
import { DESKTOP_VOICE_CALL_CHANNEL } from './desktop-voice-call-bridge';
import { useDesktopVoiceCallBridge } from './useDesktopVoiceCallBridge';

class InMemoryVoiceBridge {
  private readonly listeners = new Set<(message: unknown) => void>();
  readonly messages: unknown[] = [];

  port(): DesktopVoiceCallBridgePort {
    return {
      post: (message) => {
        this.messages.push(structuredClone(message));
        for (const listener of this.listeners) listener(message);
      },
      subscribe: (listener) => {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
      },
      close: () => undefined,
    };
  }
}

function voiceCall(overrides: Partial<UseVoiceCall> = {}): UseVoiceCall {
  return {
    active: false,
    phase: 'idle',
    activity: null,
    activeOperations: [],
    errorReason: null,
    microphoneMuted: false,
    waitingSoundEnabled: true,
    localPiperInstallRequired: false,
    localPiperInstalling: false,
    lastTranscript: null,
    inputAnalyser: null,
    outputAnalyser: null,
    open: vi.fn(),
    close: vi.fn(),
    retry: vi.fn(),
    installLocalPiper: vi.fn(),
    muteMicrophone: vi.fn(),
    unmuteMicrophone: vi.fn(),
    toggleWaitingSound: vi.fn(),
    finishUtterance: vi.fn(),
    restartListening: vi.fn(),
    bargeIn: vi.fn(),
    ...overrides,
  };
}

describe('useDesktopVoiceCallBridge', () => {
  it('keeps its owned bridge alive after the StrictMode effect replay', async () => {
    const requester = new BroadcastChannel(DESKTOP_VOICE_CALL_CHANNEL);
    const ownerClose = vi.fn();
    const wrapper = ({ children }: { readonly children: ReactNode }): JSX.Element => (
      <StrictMode>{children}</StrictMode>
    );
    const { unmount } = renderHook(() => useDesktopVoiceCallBridge({
      surface: 'main',
      workspaceId: 'ws-strict-mode',
      localCall: voiceCall({ active: true, phase: 'listening', close: ownerClose }),
    }), { wrapper });

    try {
      requester.postMessage({
        type: 'command',
        source: 'focus',
        workspaceId: 'ws-strict-mode',
        command: 'close',
      } satisfies DesktopVoiceCallBridgeMessage);

      await waitFor(() => expect(ownerClose).toHaveBeenCalledOnce());
    } finally {
      unmount();
      requester.close();
    }
  });

  it('mirrors an active main-window call and routes Focus controls to its owner', async () => {
    const bus = new InMemoryVoiceBridge();
    const ownerClose = vi.fn();
    const mainCall = voiceCall({
      active: true,
      phase: 'working',
      activity: 'editing',
      close: ownerClose,
    });
    const focusCall = voiceCall();
    const mainPort = bus.port();
    const focusPort = bus.port();

    const { result } = renderHook(() => {
      const main = useDesktopVoiceCallBridge({
        surface: 'main',
        workspaceId: 'ws-1',
        localCall: mainCall,
        port: mainPort,
      });
      const focus = useDesktopVoiceCallBridge({
        surface: 'focus',
        workspaceId: 'ws-1',
        localCall: focusCall,
        port: focusPort,
      });
      return { main, focus };
    });

    await waitFor(() => expect(result.current.focus.active).toBe(true));
    expect(result.current.focus.phase).toBe('working');
    expect(result.current.focus.activity).toBe('editing');

    act(() => result.current.focus.close());
    expect(ownerClose).toHaveBeenCalledOnce();
    expect(focusCall.close).not.toHaveBeenCalled();
  });

  it('mirrors the owner queue and routes removal back to that renderer', async () => {
    const bus = new InMemoryVoiceBridge();
    const dropQueuedTurn = vi.fn();
    const mainPort = bus.port();
    const focusPort = bus.port();
    const queuedTurns = [{ id: 'q-7', prompt: 'Transcribed follow-up' }];

    const { result } = renderHook(() => {
      const main = useDesktopVoiceCallBridge({
        surface: 'main',
        workspaceId: 'ws-queue',
        localCall: voiceCall({ active: true, phase: 'thinking' }),
        port: mainPort,
        queuedTurns,
        dropQueuedTurn,
      } as Parameters<typeof useDesktopVoiceCallBridge>[0] & {
        readonly queuedTurns: ReadonlyArray<{ readonly id: string; readonly prompt: string }>;
        readonly dropQueuedTurn: (id: string) => void;
      });
      const focus = useDesktopVoiceCallBridge({
        surface: 'focus',
        workspaceId: 'ws-queue',
        localCall: voiceCall(),
        port: focusPort,
      });
      return { main, focus };
    });

    type RemoteQueue = {
      readonly remoteQueuedTurns: ReadonlyArray<{ readonly id: string; readonly prompt: string }>;
      readonly dropRemoteQueuedTurn: (id: string) => void;
    };
    const remote = (): RemoteQueue => result.current.focus as unknown as RemoteQueue;

    await waitFor(() => expect(remote().remoteQueuedTurns).toEqual(queuedTurns));
    act(() => remote().dropRemoteQueuedTurn('q-7'));
    expect(dropQueuedTurn).toHaveBeenCalledWith('q-7');
    expect(remote().remoteQueuedTurns).toEqual([]);
  });

  it('opens Voice Mode in the main renderer when Focus initiates the call', async () => {
    const bus = new InMemoryVoiceBridge();
    const ownerOpen = vi.fn();
    const focusLocalOpen = vi.fn();
    const mainPort = bus.port();
    const focusPort = bus.port();

    const { result } = renderHook(() => {
      const main = useDesktopVoiceCallBridge({
        surface: 'main',
        workspaceId: 'ws-focus-open',
        localCall: voiceCall({ open: ownerOpen }),
        port: mainPort,
      });
      const focus = useDesktopVoiceCallBridge({
        surface: 'focus',
        workspaceId: 'ws-focus-open',
        localCall: voiceCall({ open: focusLocalOpen }),
        port: focusPort,
      });
      return { main, focus };
    });

    await waitFor(() => expect(bus.messages).toContainEqual(expect.objectContaining({
      type: 'snapshot',
      source: 'main',
      workspaceId: 'ws-focus-open',
    })));
    act(() => result.current.focus.open());

    expect(ownerOpen).toHaveBeenCalledOnce();
    expect(focusLocalOpen).not.toHaveBeenCalled();
  });

  it('routes Local Piper installation from Focus Mode to the call owner', async () => {
    const bus = new InMemoryVoiceBridge();
    const installLocalPiper = vi.fn();
    const mainPort = bus.port();
    const focusPort = bus.port();

    const { result } = renderHook(() => {
      const main = useDesktopVoiceCallBridge({
        surface: 'main',
        workspaceId: 'ws-piper',
        localCall: voiceCall({
          active: true,
          phase: 'error',
          localPiperInstallRequired: true,
          installLocalPiper,
        }),
        port: mainPort,
      });
      const focus = useDesktopVoiceCallBridge({
        surface: 'focus',
        workspaceId: 'ws-piper',
        localCall: voiceCall(),
        port: focusPort,
      });
      return { main, focus };
    });

    await waitFor(() => expect(result.current.focus.localPiperInstallRequired).toBe(true));
    act(() => result.current.focus.installLocalPiper());
    expect(installLocalPiper).toHaveBeenCalledOnce();
  });

  it('mirrors bounded microphone spectrum data without moving audio ownership', async () => {
    vi.useFakeTimers();
    const bus = new InMemoryVoiceBridge();
    const bins = new Uint8Array([4, 12, 24, 48]);
    const analyser = {
      frequencyBinCount: bins.length,
      getByteFrequencyData: (target: Uint8Array) => target.set(bins),
    };
    const mainPort = bus.port();
    const focusPort = bus.port();

    const { result, unmount } = renderHook(() => {
      const main = useDesktopVoiceCallBridge({
        surface: 'main',
        workspaceId: 'ws-1',
        localCall: voiceCall({
          active: true,
          phase: 'listening',
          inputAnalyser: analyser,
        }),
        port: mainPort,
      });
      const focus = useDesktopVoiceCallBridge({
        surface: 'focus',
        workspaceId: 'ws-1',
        localCall: voiceCall(),
        port: focusPort,
      });
      return { main, focus };
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(60);
    });
    expect(result.current.focus.active).toBe(true);
    expect(result.current.focus.phase).toBe('listening');
    expect(bus.messages.filter((message) => (
      message as { type?: string }
    ).type === 'spectrum')).not.toEqual([]);
    expect(bus.messages.at(-1)).not.toMatchObject({ type: 'spectrum-clear' });
    const remoteAnalyser = result.current.focus.inputAnalyser as {
      readonly frequencyBinCount: number;
      getByteFrequencyData(target: Uint8Array): void;
    };
    const copied = new Uint8Array(remoteAnalyser.frequencyBinCount);
    remoteAnalyser.getByteFrequencyData(copied);
    expect([...copied]).toEqual([...bins]);
    expect(result.current.focus.outputAnalyser).toBeNull();

    unmount();
    vi.useRealTimers();
  });

  it('ignores messages for another workspace', async () => {
    const bus = new InMemoryVoiceBridge();
    const focusPort = bus.port();
    const emitter = bus.port();
    const { result } = renderHook(() => useDesktopVoiceCallBridge({
      surface: 'focus',
      workspaceId: 'ws-1',
      localCall: voiceCall(),
      port: focusPort,
    }));

    act(() => emitter.post({
      type: 'snapshot',
      source: 'main',
      workspaceId: 'ws-2',
      snapshot: {
        active: true,
        phase: 'listening',
        activity: null,
        errorReason: null,
        microphoneMuted: false,
        waitingSoundEnabled: true,
        localPiperInstallRequired: false,
        localPiperInstalling: false,
        queuedTurns: [],
      },
    } satisfies DesktopVoiceCallBridgeMessage));

    await Promise.resolve();
    expect(result.current.active).toBe(false);
  });

  it('retries Focus snapshot hydration until the main window responds', async () => {
    vi.useFakeTimers();
    const bus = new InMemoryVoiceBridge();
    const focusPort = bus.port();
    const ownerPort = bus.port();
    const { result, unmount } = renderHook(() => useDesktopVoiceCallBridge({
      surface: 'focus',
      workspaceId: 'ws-1',
      localCall: voiceCall(),
      port: focusPort,
    }));
    const snapshotRequestCount = (): number => bus.messages.filter((message) => (
      message as { type?: string }
    ).type === 'snapshot-request').length;

    try {
      expect(snapshotRequestCount()).toBe(1);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(260);
      });
      expect(snapshotRequestCount()).toBe(2);

      act(() => ownerPort.post({
        type: 'snapshot',
        source: 'main',
        workspaceId: 'ws-1',
        snapshot: {
          active: true,
          phase: 'listening',
          activity: null,
          errorReason: null,
          microphoneMuted: false,
          waitingSoundEnabled: true,
          localPiperInstallRequired: false,
          localPiperInstalling: false,
          queuedTurns: [],
        },
      }));
      expect(result.current.active).toBe(true);
      const countAfterHydration = snapshotRequestCount();

      await act(async () => {
        await vi.advanceTimersByTimeAsync(1_000);
      });
      expect(snapshotRequestCount()).toBe(countAfterHydration);
    } finally {
      unmount();
      vi.useRealTimers();
    }
  });
});
