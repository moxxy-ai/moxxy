/**
 * Tests for the three-stage focus widget. The point of these tests
 * is to lock down:
 *
 *   1. Each stage renders a visible, clickable affordance — no
 *      empty / blank tile regressions.
 *   2. Stage transitions are wired correctly (inactive → active →
 *      mini-text / mini-voice → back).
 *   3. Every transition fires focus.resize so the BrowserWindow
 *      grows / shrinks with the content — and the mini-text stage
 *      enables edge-resize (`resizable: true`).
 *   4. The text composer in mini-text actually invokes
 *      session.runTurn for the active workspace (the bidirectional
 *      sync test — the focus widget must send to the runner just
 *      like the main window does).
 *   5. A runner.event arriving on the runner.event channel updates
 *      the focus widget's latest preview, rendered as Markdown
 *      (the receive side of the bidirectional sync).
 */

import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { act, cleanup, render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { __setApiOverride, configurePlatform } from '@moxxy/client-core';
import { askStore, chatStore } from '@moxxy/client-core';
import type { MoxxyEvent } from '@moxxy/sdk';
import { asTurnId, assertDefined } from '@moxxy/sdk';
import type { AskRequest, ThemePreference } from '@moxxy/desktop-ipc-contract';
import { FocusWidget } from './FocusWidget';
import { __resetThemeForTests } from '@/lib/useTheme';
import { style as focusStyle } from './focus-styles';
import { DESKTOP_VOICE_CALL_CHANNEL } from '../voice-call/desktop-voice-call-bridge';

interface IpcSpy {
  invokes: Array<{ channel: string; args: unknown }>;
  emit: (channel: string, payload: unknown) => void;
}

interface FakeApiOptions {
  readonly historyEvents?: ReadonlyArray<MoxxyEvent>;
  readonly hasTranscriber?: boolean;
  readonly theme?: ThemePreference;
  readonly horizontalAnchor?: 'left' | 'right';
  readonly focusMiniTextSize?: { readonly width: number; readonly height: number } | null;
  readonly activeSynthesizer?: string | null;
  readonly localPiperInstalled?: boolean;
}

interface FakeMedia {
  matches: boolean;
  fire: () => void;
}

function event(
  seq: number,
  patch: Partial<MoxxyEvent> & { type: MoxxyEvent['type']; turnId?: string },
): MoxxyEvent {
  return {
    id: `e-${seq}`,
    seq,
    ts: seq,
    sessionId: 's-test',
    turnId: patch.turnId ?? `t-${seq}`,
    ...patch,
  } as MoxxyEvent;
}

function permissionAsk(requestId = 'ask-focus-1'): AskRequest {
  return {
    requestId,
    workspaceId: 'ws-test',
    kind: 'permission',
    tool: {
      name: 'Bash',
      description: 'Run a shell command',
      input: { command: 'pnpm build' },
    },
  };
}

function installFakeApi(options: FakeApiOptions = {}): IpcSpy {
  const invokes: Array<{ channel: string; args: unknown }> = [];
  const subs = new Map<string, Set<(payload: unknown) => void>>();
  const historyEvents = options.historyEvents ?? [];
  const hasTranscriber = options.hasTranscriber ?? true;
  const theme = options.theme ?? 'system';
  const horizontalAnchor = options.horizontalAnchor ?? 'right';
  const focusMiniTextSize = options.focusMiniTextSize ?? null;
  let activeSynthesizer = options.activeSynthesizer ?? 'local-piper';
  let localPiperInstalled = options.localPiperInstalled ?? true;

  __setApiOverride({
    invoke: ((channel: string, args: unknown) => {
      invokes.push({ channel, args });
      // Connection / chat read APIs need sensible defaults so the
      // bridges don't reject on mount.
      if (channel === 'connection.snapshotAll') {
        return Promise.resolve([
          {
            workspaceId: 'ws-test',
            phase: { phase: 'connected' },
            cliPath: null,
            attempts: 0,
            log: [],
          },
        ]);
      }
      if (channel === 'connection.activeWorkspace') {
        return Promise.resolve('ws-test');
      }
      if (channel === 'chat.loadHistory') {
        return Promise.resolve({ events: historyEvents, prevCursor: null });
      }
      if (channel === 'focus.resize') {
        return Promise.resolve({ horizontalAnchor });
      }
      if (channel === 'focus.moveBy') {
        return Promise.resolve({ horizontalAnchor });
      }
      if (
        channel === 'focus.dragStart' ||
        channel === 'focus.dragMove'
      ) {
        return Promise.resolve({ horizontalAnchor });
      }
      if (channel === 'focus.dragEnd') {
        return Promise.resolve(undefined);
      }
      if (channel === 'session.runTurn') {
        return Promise.resolve({ turnId: 't-1' });
      }
      if (channel === 'session.saveImageAttachment') {
        return Promise.resolve({ path: '/tmp/moxxy-focus/screen.png', name: 'screen.png' });
      }
      if (channel === 'session.previewAttachment') {
        return Promise.resolve({
          kind: 'image',
          name: 'screen.png',
          mediaType: 'image/png',
          base64: 'iVBORw0KGgo=',
          byteLength: 8,
        });
      }
      if (channel === 'session.hasTranscriber') {
        return Promise.resolve(hasTranscriber);
      }
      if (channel === 'session.info') {
        return Promise.resolve({ activeSynthesizer });
      }
      if (channel === 'voice.isLocalPiperInstalled') {
        return Promise.resolve(localPiperInstalled);
      }
      if (channel === 'voice.installLocalPiper') {
        localPiperInstalled = true;
        activeSynthesizer = 'local-piper';
        return Promise.resolve(undefined);
      }
      if (channel === 'session.synthesize') {
        return Promise.resolve({ audioBase64: 'AA==', mimeType: 'audio/wav' });
      }
      if (channel === 'prefs.read') {
        return Promise.resolve({ theme, focusMiniTextSize });
      }
      if (channel === 'prefs.update') {
        return Promise.resolve({
          theme: (args as { theme?: ThemePreference }).theme ?? theme,
          focusMiniTextSize:
            (args as { focusMiniTextSize?: { width: number; height: number } | null })
              .focusMiniTextSize ?? focusMiniTextSize,
        });
      }
      return Promise.resolve(undefined);
    }) as never,
    subscribe: ((channel: string, cb: (payload: unknown) => void) => {
      let set = subs.get(channel);
      if (!set) {
        set = new Set();
        subs.set(channel, set);
      }
      set.add(cb);
      return () => {
        set?.delete(cb);
      };
    }) as never,
  } as never);

  return {
    invokes,
    emit: (channel, payload) => {
      const set = subs.get(channel);
      if (set) for (const cb of set) cb(payload);
    },
  };
}

function installMatchMedia(initialMatches: boolean): FakeMedia {
  const listeners = new Set<() => void>();
  const state: FakeMedia = {
    matches: initialMatches,
    fire: () => {
      for (const l of listeners) l();
    },
  };
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: (query: string) => ({
      media: query,
      get matches() {
        return state.matches;
      },
      addEventListener: (_: string, cb: () => void) => listeners.add(cb),
      removeEventListener: (_: string, cb: () => void) => listeners.delete(cb),
    }),
  });
  return state;
}

beforeEach(() => {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
  installMatchMedia(false);
  __resetThemeForTests();
  // Each test gets a fresh workspace chat so latest-line / sending
  // states don't bleed across cases.
  chatStore.drop('ws-test');
  for (const ask of askStore.getAll()) askStore.resolve(ask.requestId);
});

afterEach(() => {
  vi.useRealTimers();
  configurePlatform({});
  for (const ask of askStore.getAll()) askStore.resolve(ask.requestId);
  cleanup();
  __setApiOverride(null);
  __resetThemeForTests();
  vi.restoreAllMocks();
});

const themeAttr = (): string | undefined => document.documentElement.dataset.theme;
const focusCss = (): string => document.getElementById('focus-keyframes')?.textContent ?? '';

function pasteImage(input: HTMLElement): void {
  const file = new File(['focus image'], 'screen.png', { type: 'image/png' });
  fireEvent.paste(input, {
    clipboardData: {
      items: [
        {
          kind: 'file',
          type: 'image/png',
          getAsFile: () => file,
        },
      ],
    },
  });
}

describe('FocusWidget stages', () => {
  it('renders the inactive Moxxy pet with a visible activate button', () => {
    installFakeApi();
    render(<FocusWidget />);
    const button = screen.getByRole('button', { name: /click to expand/i });
    expect(button).toBeTruthy();
    expect(screen.getByTestId('focus-pet')).toHaveAttribute('data-phase', 'idle');
    expect(screen.getByTestId('focus-pet-canvas')).toHaveAttribute(
      'data-avatar-assets',
      'focus',
    );
  });

  it('renders the inactive pet without native button chrome', () => {
    installFakeApi({ theme: 'dark' });
    render(<FocusWidget />);

    const button = screen.getByRole('button', { name: /click to expand/i });
    expect(button.getAttribute('style')).toContain('appearance: none');
    expect(focusStyle.inactiveButton).toMatchObject({
      appearance: 'none',
      WebkitAppearance: 'none',
      outline: 'none',
    });
  });

  it('keeps the collapsed window tight to the Moxxy pet', async () => {
    const spy = installFakeApi({ theme: 'dark' });
    render(<FocusWidget />);

    await waitFor(() => {
      const resize = spy.invokes.find(
        (i) =>
          i.channel === 'focus.resize' &&
          (i.args as { width?: number; height?: number }).width === 84 &&
          (i.args as { width?: number; height?: number }).height === 104,
      );
      expect(resize).toBeTruthy();
    });

    const button = screen.getByRole('button', { name: /click to expand/i });
    expect(button.getAttribute('style')).toContain('width: 84px');
    expect(button.getAttribute('style')).toContain('height: 104px');
    expect(focusStyle.inactiveRoot).toMatchObject({
      background: 'transparent',
    });
  });

  it('inactive → active fires focus.resize and shows the action row', async () => {
    const spy = installFakeApi();
    render(<FocusWidget />);
    fireEvent.click(screen.getByRole('button', { name: /click to expand/i }));
    expect(screen.getByRole('button', { name: /^text$/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /open main window/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /close focus mode/i })).toBeTruthy();
    expect(screen.getByTestId('focus-pet')).toBeTruthy();
    await waitFor(() => {
      const resize = spy.invokes.find(
        (i) =>
          i.channel === 'focus.resize' &&
          (i.args as { width: number; height: number }).width >= 280 &&
          (i.args as { width: number; height: number }).width <= 360 &&
          (i.args as { width: number; height: number }).height === 90,
      );
      expect(resize).toBeTruthy();
    });
  });

  it('active → mini-text shows the composer input + send', () => {
    installFakeApi();
    render(<FocusWidget />);
    fireEvent.click(screen.getByRole('button', { name: /click to expand/i }));
    fireEvent.click(screen.getByRole('button', { name: /^text$/i }));
    expect(screen.getByPlaceholderText(/ask moxxy|no active workspace/i)).toBeTruthy();
    expect(screen.getByRole('button', { name: /^send$/i })).toBeTruthy();
  });

  it('active → mini-text enables edge-resize via focus.resize', async () => {
    const spy = installFakeApi();
    render(<FocusWidget />);
    fireEvent.click(screen.getByRole('button', { name: /click to expand/i }));
    fireEvent.click(screen.getByRole('button', { name: /^text$/i }));
    await waitFor(() => {
      const resize = spy.invokes.find(
        (i) =>
          i.channel === 'focus.resize' &&
          (i.args as { resizable?: boolean }).resizable === true,
      );
      expect(resize).toBeTruthy();
    });
  });

  it('shows the mic button when the runner has a transcriber', async () => {
    installFakeApi();
    render(<FocusWidget />);
    fireEvent.click(screen.getByRole('button', { name: /click to expand/i }));
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /^record voice$/i })).toBeTruthy();
    });
  });

  it('hides the mic button when the runner has no transcriber', async () => {
    installFakeApi({ hasTranscriber: false });
    render(<FocusWidget />);
    fireEvent.click(screen.getByRole('button', { name: /click to expand/i }));
    // Text / restore / close stay visible; mic is gone.
    expect(screen.getByRole('button', { name: /^text$/i })).toBeTruthy();
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: /record voice/i })).toBeNull();
      expect(screen.queryByRole('button', { name: /start voice mode/i })).toBeNull();
    });
  });

  it('keeps a full voice conversation active while the focus widget is collapsed', async () => {
    let captureStarts = 0;
    const cancelCapture = vi.fn();
    configurePlatform({
      audioCapture: {
        isSupported: () => true,
        start: async () => {
          captureStarts += 1;
          return { stop: vi.fn(), cancel: cancelCapture };
        },
      },
    });
    installFakeApi();
    render(<FocusWidget />);

    fireEvent.click(screen.getByRole('button', { name: /click to expand/i }));
    fireEvent.click(await screen.findByRole('button', { name: /start voice mode/i }));

    await screen.findByRole('button', { name: /end voice mode/i });
    await waitFor(() => expect(captureStarts).toBe(1));
    expect(screen.queryByRole('button', { name: /^record voice$/i })).toBeNull();
    expect(screen.getByRole('button', { name: /mute microphone/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /turn waiting sound off/i })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /^collapse$/i }));
    expect(screen.getByRole('button', { name: /voice mode active.*click to expand/i })).toBeTruthy();
    expect(cancelCapture).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: /voice mode active.*click to expand/i }));
    fireEvent.click(screen.getByRole('button', { name: /end voice mode/i }));
    await waitFor(() => expect(cancelCapture).toHaveBeenCalledTimes(1));
    expect(screen.getByRole('button', { name: /start voice mode/i })).toBeTruthy();
  });

  it('adopts an active main-window call without restarting it and routes controls back', async () => {
    installFakeApi();
    const canvasContext = vi
      .spyOn(HTMLCanvasElement.prototype, 'getContext')
      .mockReturnValue(null);
    const owner = new BroadcastChannel(DESKTOP_VOICE_CALL_CHANNEL);
    const received: unknown[] = [];
    owner.addEventListener('message', (message: MessageEvent<unknown>) => {
      received.push(message.data);
    });

    try {
      render(<FocusWidget />);
      await waitFor(() => {
        expect(received).toContainEqual(expect.objectContaining({
          type: 'snapshot-request',
          source: 'focus',
          workspaceId: 'ws-test',
        }));
      });

      owner.postMessage({
        type: 'snapshot',
        source: 'main',
        workspaceId: 'ws-test',
        snapshot: {
          active: true,
          phase: 'listening',
          activity: null,
          errorReason: null,
          microphoneMuted: false,
          waitingSoundEnabled: true,
          localPiperInstallRequired: false,
          localPiperInstalling: false,
        },
      });
      owner.postMessage({
        type: 'spectrum',
        source: 'main',
        workspaceId: 'ws-test',
        audioSource: 'microphone',
        bins: new Uint8Array([8, 18, 32, 48]),
      });

      expect(await screen.findByRole('button', { name: /end voice mode/i })).toBeTruthy();
      expect(screen.getByTestId('focus-audio-waveform')).toHaveAttribute(
        'data-audio-source',
        'microphone',
      );
      expect(screen.getByTestId('focus-pet')).toHaveAttribute('data-phase', 'listening');
      fireEvent.click(screen.getByRole('button', { name: /mute microphone/i }));
      await waitFor(() => {
        expect(received).toContainEqual(expect.objectContaining({
          type: 'command',
          source: 'focus',
          workspaceId: 'ws-test',
          command: 'mute-microphone',
        }));
      });

      fireEvent.click(screen.getByRole('button', { name: /^collapse$/i }));
      expect(screen.getByRole('button', {
        name: /voice mode active.*click to expand/i,
      })).toBeTruthy();

      owner.postMessage({
        type: 'snapshot',
        source: 'main',
        workspaceId: 'ws-test',
        snapshot: {
          active: true,
          phase: 'working',
          activity: 'editing',
          errorReason: null,
          microphoneMuted: false,
          waitingSoundEnabled: true,
          localPiperInstallRequired: false,
          localPiperInstalling: false,
        },
      });
      await waitFor(() => {
        expect(document.querySelector('.focus-voice-live')?.getAttribute('data-phase'))
          .toBe('working');
      });
      expect(screen.queryByRole('button', { name: /end voice mode/i })).toBeNull();
    } finally {
      owner.close();
      canvasContext.mockRestore();
    }
  });

  it('exposes the full voice microphone and waiting-sound controls in focus mode', async () => {
    let captureStarts = 0;
    const cancelCapture = vi.fn();
    const preferences = new Map<string, string>();
    configurePlatform({
      audioCapture: {
        isSupported: () => true,
        start: async () => {
          captureStarts += 1;
          return { stop: vi.fn(), cancel: cancelCapture };
        },
      },
      kv: {
        get length() { return preferences.size; },
        key: (index) => [...preferences.keys()][index] ?? null,
        getItem: (key) => preferences.get(key) ?? null,
        setItem: (key, value) => preferences.set(key, value),
        removeItem: (key) => preferences.delete(key),
      },
    });
    installFakeApi();
    render(<FocusWidget />);

    fireEvent.click(screen.getByRole('button', { name: /click to expand/i }));
    fireEvent.click(await screen.findByRole('button', { name: /start voice mode/i }));
    await waitFor(() => expect(captureStarts).toBe(1));

    const muteButton = screen.getByRole('button', { name: /mute microphone/i });
    expect(muteButton.querySelector('[data-voice-microphone-muted="false"]')).toBeTruthy();
    expect(muteButton).toHaveAttribute('aria-pressed', 'true');
    expect(screen.queryByRole('button', { name: /^record voice$/i })).toBeNull();

    fireEvent.click(muteButton);
    await waitFor(() => expect(cancelCapture).toHaveBeenCalledTimes(1));
    const unmuteButton = screen.getByRole('button', { name: /unmute microphone/i });
    expect(unmuteButton.querySelector('[data-voice-microphone-muted="true"]')).toBeTruthy();
    expect(unmuteButton).toHaveAttribute('aria-pressed', 'false');

    fireEvent.click(screen.getByRole('button', { name: /turn waiting sound off/i }));
    expect(screen.getByRole('button', { name: /turn waiting sound on/i })).toBeTruthy();
    expect(preferences.get('moxxy.voice.waiting-sound')).toBe('0');

    fireEvent.click(screen.getByRole('button', { name: /unmute microphone/i }));
    await waitFor(() => expect(captureStarts).toBe(2));
  });

  it('renders the existing Focus waveform from the full voice microphone analyser', async () => {
    const canvasContext = vi.spyOn(HTMLCanvasElement.prototype, 'getContext')
      .mockReturnValue(null);
    try {
      const inputAnalyser = {
        frequencyBinCount: 128,
        getByteFrequencyData: (data: Uint8Array) => data.fill(72),
      };
      configurePlatform({
        audioCapture: {
          isSupported: () => true,
          start: async (options) => {
            options.onAnalyser?.(inputAnalyser);
            return { stop: () => undefined, cancel: () => options.onAnalyser?.(null) };
          },
        },
      });
      installFakeApi();
      render(<FocusWidget />);

      fireEvent.click(screen.getByRole('button', { name: /click to expand/i }));
      fireEvent.click(await screen.findByRole('button', { name: /start voice mode/i }));

      const waveform = await screen.findByTestId('focus-audio-waveform');
      expect(waveform.getAttribute('data-audio-source')).toBe('microphone');
      expect(screen.queryByRole('button', { name: /^record voice$/i })).toBeNull();
    } finally {
      canvasContext.mockRestore();
    }
  });

  it('switches the Focus waveform to Piper output while Moxxy speaks', async () => {
    const canvasContext = vi.spyOn(HTMLCanvasElement.prototype, 'getContext')
      .mockReturnValue(null);
    try {
      const inputAnalyser = {
        frequencyBinCount: 128,
        getByteFrequencyData: (data: Uint8Array) => data.fill(32),
      };
      const outputAnalyser = {
        frequencyBinCount: 128,
        getByteFrequencyData: (data: Uint8Array) => data.fill(96),
      };
      configurePlatform({
        audioCapture: {
          isSupported: () => true,
          start: async (options) => {
            options.onAnalyser?.(inputAnalyser);
            return { stop: () => undefined, cancel: () => options.onAnalyser?.(null) };
          },
        },
        tts: {
          isSupported: () => true,
          speak: () => undefined,
          cancel: () => undefined,
          playClip: (_base64, _mimeType, options) => {
            options?.onAnalyser?.(outputAnalyser);
            return { stop: () => options?.onAnalyser?.(null) };
          },
        },
      });
      const spy = installFakeApi();
      const outputTurnId = asTurnId('t-voice-output');
      render(<FocusWidget />);

      fireEvent.click(screen.getByRole('button', { name: /click to expand/i }));
      fireEvent.click(await screen.findByRole('button', { name: /start voice mode/i }));
      await screen.findByTestId('focus-audio-waveform');

      act(() => {
        spy.emit('runner.turn.started', { workspaceId: 'ws-test', turnId: outputTurnId });
        spy.emit('runner.event', {
          workspaceId: 'ws-test',
          event: event(301, {
            type: 'assistant_chunk',
            turnId: outputTurnId,
            delta: 'Hello from Moxxy.',
          }),
        });
      });

      await waitFor(() => {
        expect(screen.getByTestId('focus-audio-waveform').getAttribute('data-audio-source'))
          .toBe('assistant');
        expect(screen.getByTestId('focus-pet')).toHaveAttribute('data-phase', 'speaking');
      });
    } finally {
      canvasContext.mockRestore();
    }
  });

  it('releases a one-shot recording before starting the full voice conversation', async () => {
    const captureCancels: Array<ReturnType<typeof vi.fn>> = [];
    configurePlatform({
      audioCapture: {
        isSupported: () => true,
        start: async () => {
          const cancel = vi.fn();
          captureCancels.push(cancel);
          return { stop: vi.fn(), cancel };
        },
      },
    });
    installFakeApi();
    render(<FocusWidget />);

    fireEvent.click(screen.getByRole('button', { name: /click to expand/i }));
    fireEvent.click(await screen.findByRole('button', { name: /^record voice$/i }));
    await waitFor(() => expect(captureCancels).toHaveLength(1));

    fireEvent.click(screen.getByRole('button', { name: /start voice mode/i }));
    await waitFor(() => {
      expect(captureCancels[0]).toHaveBeenCalledTimes(1);
      expect(captureCancels).toHaveLength(2);
    });
  });

  it('shows retry and end controls when the shared voice preflight fails', async () => {
    const spy = installFakeApi({ activeSynthesizer: 'elevenlabs' });
    render(<FocusWidget />);

    fireEvent.click(screen.getByRole('button', { name: /click to expand/i }));
    fireEvent.click(await screen.findByRole('button', { name: /start voice mode/i }));

    const retry = await screen.findByRole('button', { name: /retry voice mode/i });
    expect(screen.getByRole('button', { name: /end voice mode/i })).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toMatch(/local piper is not active/i);

    fireEvent.click(retry);
    await waitFor(() => {
      expect(spy.invokes.filter((invoke) => invoke.channel === 'session.info')).toHaveLength(2);
    });
  });

  it('hides Voice Mode entirely when Local Piper is not installed', async () => {
    const spy = installFakeApi({
      activeSynthesizer: 'elevenlabs',
      localPiperInstalled: false,
    });
    render(<FocusWidget />);

    fireEvent.click(screen.getByRole('button', { name: /click to expand/i }));
    await screen.findByRole('button', { name: /^record voice$/i });
    await waitFor(() => {
      expect(spy.invokes.some((invoke) => (
        invoke.channel === 'voice.isLocalPiperInstalled'
      ))).toBe(true);
    });
    expect(screen.queryByRole('button', { name: /start voice mode/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /install local piper/i })).toBeNull();
  });

  it('mini-text → back returns to the active stage', () => {
    installFakeApi();
    render(<FocusWidget />);
    fireEvent.click(screen.getByRole('button', { name: /click to expand/i }));
    fireEvent.click(screen.getByRole('button', { name: /^text$/i }));
    fireEvent.click(screen.getByRole('button', { name: /^back$/i }));
    expect(screen.getByRole('button', { name: /^text$/i })).toBeTruthy();
    expect(screen.queryByPlaceholderText(/ask moxxy/i)).toBeNull();
  });

  it('active → close fires focus.close IPC', () => {
    const spy = installFakeApi();
    render(<FocusWidget />);
    fireEvent.click(screen.getByRole('button', { name: /click to expand/i }));
    fireEvent.click(screen.getByRole('button', { name: /close focus mode/i }));
    expect(spy.invokes.some((i) => i.channel === 'focus.close')).toBe(true);
  });

  it('mini → restore-main fires focus.restoreMain IPC', () => {
    const spy = installFakeApi();
    render(<FocusWidget />);
    fireEvent.click(screen.getByRole('button', { name: /click to expand/i }));
    fireEvent.click(screen.getByRole('button', { name: /^text$/i }));
    fireEvent.click(screen.getByRole('button', { name: /open main window/i }));
    expect(spy.invokes.some((i) => i.channel === 'focus.restoreMain')).toBe(true);
  });

  it('dragging the inactive pet tracks screen coordinates and does not expand it', async () => {
    const spy = installFakeApi();
    render(<FocusWidget />);

    const pet = screen.getByRole('button', { name: /click to expand/i });
    fireEvent.mouseDown(pet, {
      button: 0,
      clientX: 10,
      clientY: 10,
      screenX: 610,
      screenY: 410,
    });
    fireEvent.mouseMove(pet, {
      clientX: 14,
      clientY: 13,
      screenX: 690,
      screenY: 470,
    });
    fireEvent.mouseUp(pet, {
      clientX: 14,
      clientY: 13,
      screenX: 690,
      screenY: 470,
    });

    await waitFor(() => {
      expect(spy.invokes.some((i) => i.channel === 'focus.dragStart')).toBe(true);
      const move = spy.invokes.find((i) => i.channel === 'focus.dragMove');
      expect(move).toBeTruthy();
      assertDefined(move, 'focus.dragMove invoke');
      expect(move.args).toEqual({ screenX: 690, screenY: 470 });
      expect(spy.invokes.some((i) => i.channel === 'focus.dragEnd')).toBe(true);
    });
    expect(spy.invokes.some((i) => i.channel === 'focus.moveBy')).toBe(false);
    expect(screen.queryByRole('button', { name: /^text$/i })).toBeNull();
  });
});

describe('FocusWidget theme', () => {
  it('mirrors the persisted desktop dark theme onto the focus document', async () => {
    installFakeApi({ theme: 'dark' });
    render(<FocusWidget />);

    await waitFor(() => expect(themeAttr()).toBe('dark'));
  });

  it('resolves the system desktop theme to the OS dark scheme inside focus mode', async () => {
    installMatchMedia(true);
    installFakeApi({ theme: 'system' });
    render(<FocusWidget />);

    await waitFor(() => expect(themeAttr()).toBe('dark'));
  });

  it('styles the preview bubble and mini-text controls through focus theme variables', async () => {
    const spy = installFakeApi({ theme: 'light' });
    render(<FocusWidget />);

    spy.emit('runner.event', {
      workspaceId: 'ws-test',
      event: event(24, {
        type: 'user_prompt',
        source: 'user',
        turnId: asTurnId('t-themed-preview'),
        text: 'Show the theme-aware reply',
      }),
    });
    spy.emit('runner.event', {
      workspaceId: 'ws-test',
      event: {
        id: 'e-themed-preview',
        seq: 25,
        ts: 25,
        sessionId: 's-test',
        type: 'assistant_chunk',
        turnId: 't-themed-preview',
        delta: 'theme-aware preview reply',
      } as MoxxyEvent,
    });

    const previewButton = await screen.findByRole('button', {
      name: /open latest reply/i,
    });
    expect(previewButton.getAttribute('style')).toContain(
      'background: var(--focus-preview-bg)',
    );
    expect(previewButton.getAttribute('style')).toContain(
      'color: var(--focus-preview-text)',
    );
    expect(focusStyle.replyPreviewBubble).toMatchObject({
      backdropFilter: 'none',
      WebkitBackdropFilter: 'none',
    });
    expect(focusCss()).toContain('--focus-preview-shadow: none');

    fireEvent.click(screen.getByRole('button', { name: /click to expand/i }));

    const input = await screen.findByPlaceholderText(
      /ask moxxy|no active workspace/i,
    );
    expect(input.getAttribute('style')).toContain('background: var(--focus-input-bg)');
    expect(input.getAttribute('style')).toContain('color: var(--focus-text)');
  });

  it('injects a local dark-token block for the standalone focus bundle', () => {
    installFakeApi();
    render(<FocusWidget />);

    expect(focusCss()).toContain('[data-theme="dark"]');
    expect(focusCss()).toContain('--focus-panel-bg: #12151d');
    expect(focusCss()).toContain('--focus-preview-bg: rgba(18, 21, 29, 0.96)');
  });
});

describe('FocusWidget bidirectional sync', () => {
  it('shows only the latest user question, its attachment, and matching answer in mini-text', async () => {
    const spy = installFakeApi({
      historyEvents: [
        event(1, {
          type: 'user_prompt',
          turnId: 't-old',
          source: 'user',
          text: 'older user prompt',
        } as never),
        event(2, {
          type: 'assistant_message',
          turnId: 't-old',
          source: 'model',
          content: 'older assistant answer',
          stopReason: 'end_turn',
        } as never),
        event(3, {
          type: 'user_prompt',
          turnId: 't-history',
          source: 'user',
          text: 'cached user prompt',
          attachments: [{
            kind: 'image',
            name: 'question.png',
            mediaType: 'image/png',
            content: 'iVBORw0KGgo=',
          }],
        } as never),
        event(4, {
          type: 'assistant_message',
          turnId: 't-history',
          source: 'model',
          content: 'cached assistant answer',
          stopReason: 'end_turn',
        } as never),
      ],
    });
    render(<FocusWidget />);

    fireEvent.click(screen.getByRole('button', { name: /click to expand/i }));
    fireEvent.click(screen.getByRole('button', { name: /^text$/i }));

    await waitFor(() => {
      const load = spy.invokes.find((i) => i.channel === 'chat.loadHistory');
      expect(load).toBeTruthy();
      assertDefined(load, 'chat.loadHistory invoke');
      expect((load.args as { workspaceId: string }).workspaceId).toBe('ws-test');
    });
    await waitFor(() => {
      expect(screen.getByText(/cached user prompt/i)).toBeTruthy();
      expect(screen.getByText(/cached assistant answer/i)).toBeTruthy();
      expect(screen.getByRole('button', {
        name: /preview attached image question\.png/i,
      })).toBeTruthy();
    });
    fireEvent.click(screen.getByRole('button', {
      name: /preview attached image question\.png/i,
    }));
    expect(screen.getByRole('dialog', { name: /question\.png/i })).toBeTruthy();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByText(/older user prompt/i)).toBeNull();
    expect(screen.queryByText(/older assistant answer/i)).toBeNull();
    expect(screen.getByTestId('focus-transcript').getAttribute('style')).toContain(
      'user-select: text',
    );
  });

  it('does not present an intermediate tool-use message as the final mini-text answer', async () => {
    installFakeApi({
      historyEvents: [
        event(1, {
          type: 'user_prompt',
          turnId: 't-tool',
          source: 'user',
          text: 'Run the requested operation',
        } as never),
        event(2, {
          type: 'assistant_message',
          turnId: 't-tool',
          source: 'model',
          content: 'internal tool preamble',
          stopReason: 'tool_use',
        } as never),
      ],
    });
    render(<FocusWidget />);

    fireEvent.click(screen.getByRole('button', { name: /click to expand/i }));
    fireEvent.click(screen.getByRole('button', { name: /^text$/i }));

    expect(await screen.findByText('Run the requested operation')).toBeTruthy();
    expect(screen.queryByText('internal tool preamble')).toBeNull();
  });

  it('sending from mini-text invokes session.runTurn for the active workspace', async () => {
    const spy = installFakeApi();
    render(<FocusWidget />);

    fireEvent.click(screen.getByRole('button', { name: /click to expand/i }));
    fireEvent.click(screen.getByRole('button', { name: /^text$/i }));

    // Wait for ConnectionBridge to push the active workspace id
    // through, which un-disables the input.
    await waitFor(() => {
      const input = screen.getByPlaceholderText(/ask moxxy|no active workspace/i) as HTMLTextAreaElement;
      expect(input.disabled).toBe(false);
    });

    const input = screen.getByPlaceholderText(/ask moxxy/i) as HTMLTextAreaElement;
    expect(input.tagName).toBe('TEXTAREA');
    fireEvent.change(input, { target: { value: 'hello from focus' } });
    fireEvent.click(screen.getByRole('button', { name: /^send$/i }));

    await waitFor(() => {
      const turnCall = spy.invokes.find((i) => i.channel === 'session.runTurn');
      expect(turnCall).toBeTruthy();
      assertDefined(turnCall, 'session.runTurn invoke');
      expect((turnCall.args as { prompt: string }).prompt).toBe('hello from focus');
      expect((turnCall.args as { workspaceId: string }).workspaceId).toBe(
        'ws-test',
      );
    });
  });

  it('uses Shift+Enter for a newline and Enter to send the multiline prompt', async () => {
    const spy = installFakeApi();
    render(<FocusWidget />);

    fireEvent.click(screen.getByRole('button', { name: /click to expand/i }));
    fireEvent.click(screen.getByRole('button', { name: /^text$/i }));
    const input = await screen.findByPlaceholderText(/ask moxxy/i) as HTMLTextAreaElement;

    fireEvent.change(input, { target: { value: 'first line' } });
    fireEvent.keyDown(input, { key: 'Enter', shiftKey: true });
    expect(spy.invokes.some((invoke) => invoke.channel === 'session.runTurn')).toBe(false);

    fireEvent.change(input, { target: { value: 'first line\nsecond line' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => {
      const turnCall = spy.invokes.find((invoke) => invoke.channel === 'session.runTurn');
      expect(turnCall).toBeTruthy();
      assertDefined(turnCall, 'multiline session.runTurn invoke');
      expect((turnCall.args as { prompt: string }).prompt).toBe('first line\nsecond line');
    });
  });

  it('grows the mini-text textarea up to its bounded maximum height', async () => {
    installFakeApi();
    render(<FocusWidget />);

    fireEvent.click(screen.getByRole('button', { name: /click to expand/i }));
    fireEvent.click(screen.getByRole('button', { name: /^text$/i }));
    const input = await screen.findByPlaceholderText(/ask moxxy/i) as HTMLTextAreaElement;

    Object.defineProperty(input, 'scrollHeight', { configurable: true, value: 86 });
    fireEvent.change(input, { target: { value: 'first\nsecond\nthird' } });
    expect(input.style.height).toBe('86px');

    Object.defineProperty(input, 'scrollHeight', { configurable: true, value: 180 });
    fireEvent.change(input, { target: { value: 'first\nsecond\nthird\nfourth' } });
    expect(input.style.height).toBe('112px');
  });

  it('does not send Enter while an IME composition is active', async () => {
    const spy = installFakeApi();
    render(<FocusWidget />);

    fireEvent.click(screen.getByRole('button', { name: /click to expand/i }));
    fireEvent.click(screen.getByRole('button', { name: /^text$/i }));
    const input = await screen.findByPlaceholderText(/ask moxxy/i) as HTMLTextAreaElement;

    fireEvent.change(input, { target: { value: 'composed text' } });
    fireEvent.keyDown(input, { key: 'Enter', isComposing: true });

    expect(spy.invokes.some((invoke) => invoke.channel === 'session.runTurn')).toBe(false);
    expect(input.value).toBe('composed text');
  });

  it('shows a removable queue chip instead of starting a second concurrent turn', async () => {
    const spy = installFakeApi();
    render(<FocusWidget />);

    fireEvent.click(screen.getByRole('button', { name: /click to expand/i }));
    fireEvent.click(screen.getByRole('button', { name: /^text$/i }));
    const input = await screen.findByPlaceholderText(/ask moxxy/i) as HTMLTextAreaElement;

    fireEvent.change(input, { target: { value: 'first prompt' } });
    fireEvent.click(screen.getByRole('button', { name: /^send$/i }));
    await waitFor(() => expect(chatStore.getChat('ws-test').activeTurnId).toBe('t-1'));

    fireEvent.change(input, { target: { value: 'queued prompt' } });
    fireEvent.click(screen.getByRole('button', { name: /^send$/i }));

    expect(spy.invokes.filter((invoke) => invoke.channel === 'session.runTurn')).toHaveLength(1);
    expect(await screen.findByText('queued prompt')).toBeTruthy();
    const remove = screen.getByRole('button', { name: /drop queued message/i });
    fireEvent.click(remove);
    expect(screen.queryByText('queued prompt')).toBeNull();
    expect(chatStore.getQueue('ws-test')).toHaveLength(0);
  });

  it('pasting an image in mini-text stages a preview attachment and enables image-only send', async () => {
    const spy = installFakeApi();
    render(<FocusWidget />);

    fireEvent.click(screen.getByRole('button', { name: /click to expand/i }));
    fireEvent.click(screen.getByRole('button', { name: /^text$/i }));

    const input = await screen.findByPlaceholderText(/ask moxxy/i);
    pasteImage(input);

    await waitFor(() => {
      expect(spy.invokes.some((i) => i.channel === 'session.saveImageAttachment')).toBe(true);
      expect(screen.getByRole('button', { name: /preview screen\.png/i })).toBeTruthy();
    });

    const send = screen.getByRole('button', { name: /^send$/i }) as HTMLButtonElement;
    expect(send.disabled).toBe(false);
  });

  it('sends staged mini-text image attachments and clears them after submit', async () => {
    const spy = installFakeApi();
    render(<FocusWidget />);

    fireEvent.click(screen.getByRole('button', { name: /click to expand/i }));
    fireEvent.click(screen.getByRole('button', { name: /^text$/i }));

    const input = await screen.findByPlaceholderText(/ask moxxy/i);
    pasteImage(input);
    await screen.findByRole('button', { name: /preview screen\.png/i });

    fireEvent.click(screen.getByRole('button', { name: /^send$/i }));

    await waitFor(() => {
      const turnCall = spy.invokes.find((i) => i.channel === 'session.runTurn');
      expect(turnCall).toBeTruthy();
      assertDefined(turnCall, 'session.runTurn invoke');
      expect((turnCall.args as { attachments?: ReadonlyArray<{ path: string; name: string }> }).attachments).toEqual([
        { path: '/tmp/moxxy-focus/screen.png', name: 'screen.png' },
      ]);
    });
    expect(screen.queryByRole('button', { name: /preview screen\.png/i })).toBeNull();
  });

  it('opens and removes staged mini-text image previews without leaving the panel', async () => {
    installFakeApi();
    render(<FocusWidget />);

    fireEvent.click(screen.getByRole('button', { name: /click to expand/i }));
    fireEvent.click(screen.getByRole('button', { name: /^text$/i }));

    const input = await screen.findByPlaceholderText(/ask moxxy/i);
    pasteImage(input);
    const preview = await screen.findByRole('button', { name: /preview screen\.png/i });

    fireEvent.click(preview);
    expect(await screen.findByRole('dialog', { name: /screen\.png/i })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /close image preview/i }));

    fireEvent.click(screen.getByRole('button', { name: /remove screen\.png/i }));
    expect(screen.queryByRole('button', { name: /preview screen\.png/i })).toBeNull();
    expect(screen.getByPlaceholderText(/ask moxxy/i)).toBeTruthy();
  });

  it('uses the persisted mini-text size when opening the text panel', async () => {
    const spy = installFakeApi({ focusMiniTextSize: { width: 720, height: 620 } });
    render(<FocusWidget />);

    fireEvent.click(screen.getByRole('button', { name: /click to expand/i }));
    fireEvent.click(screen.getByRole('button', { name: /^text$/i }));

    await waitFor(() => {
      const resize = spy.invokes.find(
        (i) =>
          i.channel === 'focus.resize' &&
          (i.args as { width?: number; height?: number }).width === 720 &&
          (i.args as { width?: number; height?: number }).height === 620,
      );
      expect(resize).toBeTruthy();
    });
  });

  it('debounces mini-text resize persistence through desktop prefs', async () => {
    const spy = installFakeApi();
    render(<FocusWidget />);

    fireEvent.click(screen.getByRole('button', { name: /click to expand/i }));
    fireEvent.click(screen.getByRole('button', { name: /^text$/i }));
    await screen.findByPlaceholderText(/ask moxxy/i);
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 900 });
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 700 });
    fireEvent(window, new Event('resize'));

    await waitFor(() => {
      const update = spy.invokes.find(
        (i) =>
          i.channel === 'prefs.update' &&
          (i.args as { focusMiniTextSize?: { width: number; height: number } }).focusMiniTextSize
            ?.width === 900,
      );
      expect(update).toBeTruthy();
      assertDefined(update, 'prefs.update invoke');
      expect(update.args).toMatchObject({ focusMiniTextSize: { width: 900, height: 700 } });
    });
  });

  it('a runner.event flowing into chatStore surfaces in mini-text latest line', async () => {
    const spy = installFakeApi();
    render(<FocusWidget />);

    fireEvent.click(screen.getByRole('button', { name: /click to expand/i }));
    fireEvent.click(screen.getByRole('button', { name: /^text$/i }));

    // Simulate the runner streaming an assistant_chunk event — this
    // is what bindWindow's SessionDriver delivers to the focus
    // window when the main window sends a turn.
    spy.emit('runner.turn.started', {
      workspaceId: 'ws-test',
      turnId: asTurnId('t-incoming'),
    });
    spy.emit('runner.event', {
      workspaceId: 'ws-test',
      event: event(9, {
        type: 'user_prompt',
        source: 'user',
        turnId: asTurnId('t-incoming'),
        text: 'Question from the main window',
      }),
    });
    spy.emit('runner.event', {
      workspaceId: 'ws-test',
      event: {
        id: 'e-incoming',
        seq: 10,
        ts: 10,
        sessionId: 's-test',
        type: 'assistant_chunk',
        turnId: 't-incoming',
        delta: 'response from the main window',
      } as MoxxyEvent,
    });

    expect(chatStore.getChat('ws-test')).toMatchObject({
      activeTurnId: 't-incoming',
      streamingText: 'response from the main window',
    });
    await waitFor(() => {
      expect(screen.getByText(/response from the main window/i)).toBeTruthy();
    });
  });

  it('renders the latest assistant message as Markdown, not raw text', async () => {
    installFakeApi();
    render(<FocusWidget />);

    fireEvent.click(screen.getByRole('button', { name: /click to expand/i }));
    fireEvent.click(screen.getByRole('button', { name: /^text$/i }));

    chatStore.dispatch('ws-test', {
      type: 'send_started',
      turnId: asTurnId('t-md'),
    });
    chatStore.dispatch('ws-test', {
      type: 'event',
      event: event(1, {
        type: 'user_prompt',
        source: 'user',
        turnId: asTurnId('t-md'),
        text: 'Fetch the newest page',
      }),
    });
    chatStore.dispatch('ws-test', {
      type: 'event',
      event: {
        type: 'assistant_chunk',
        turnId: 't-md',
        delta: 'Fetched the **newest** page\n\n```ts\nconst answer = 42;\n```',
      } as never,
    });

    expect(chatStore.getChat('ws-test')).toMatchObject({
      activeTurnId: 't-md',
      streamingText: 'Fetched the **newest** page\n\n```ts\nconst answer = 42;\n```',
    });
    // The `**newest**` must render as a <strong>, not literal asterisks —
    // this is the fix for the mini-text showing raw markdown on one line.
    await waitFor(() => {
      expect(screen.getByText('newest').tagName).toBe('STRONG');
      expect(screen.getByText('const answer = 42;').tagName).toBe('CODE');
    });
  });

  it('shows an inactive assistant preview bubble and opens mini-text when the pet is clicked', async () => {
    const spy = installFakeApi();
    render(<FocusWidget />);

    spy.emit('runner.turn.started', {
      workspaceId: 'ws-test',
      turnId: asTurnId('t-preview'),
    });
    spy.emit('runner.event', {
      workspaceId: 'ws-test',
      event: event(19, {
        type: 'user_prompt',
        source: 'user',
        turnId: asTurnId('t-preview'),
        text: 'Question while collapsed',
      }),
    });
    spy.emit('runner.event', {
      workspaceId: 'ws-test',
      event: {
        id: 'e-preview',
        seq: 20,
        ts: 20,
        sessionId: 's-test',
        type: 'assistant_chunk',
        turnId: 't-preview',
        delta: 'live reply while collapsed',
      } as MoxxyEvent,
    });

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /open latest reply/i }))
        .toHaveTextContent(/live reply while collapsed/i);
    });

    fireEvent.click(screen.getByRole('button', { name: /click to expand/i }));

    await waitFor(() => {
      expect(screen.getByPlaceholderText(/ask moxxy|no active workspace/i)).toBeTruthy();
    });
    expect(screen.getByText(/live reply while collapsed/i)).toBeTruthy();
  });

  it('opens mini-text when the inactive reply bubble is clicked', async () => {
    const spy = installFakeApi();
    render(<FocusWidget />);

    spy.emit('runner.turn.started', {
      workspaceId: 'ws-test',
      turnId: asTurnId('t-preview-click'),
    });
    spy.emit('runner.event', {
      workspaceId: 'ws-test',
      event: event(20, {
        type: 'user_prompt',
        source: 'user',
        turnId: asTurnId('t-preview-click'),
        text: 'Question behind the clickable reply',
      }),
    });
    spy.emit('runner.event', {
      workspaceId: 'ws-test',
      event: {
        id: 'e-preview-click',
        seq: 21,
        ts: 21,
        sessionId: 's-test',
        type: 'assistant_chunk',
        turnId: asTurnId('t-preview-click'),
        delta: 'clickable preview reply',
      } as MoxxyEvent,
    });
    spy.emit('runner.event', {
      workspaceId: 'ws-test',
      event: event(22, {
        type: 'assistant_message',
        source: 'model',
        turnId: asTurnId('t-preview-click'),
        content: 'clickable preview reply',
        stopReason: 'end_turn',
      }),
    });
    spy.emit('runner.turn.complete', {
      workspaceId: 'ws-test',
      turnId: asTurnId('t-preview-click'),
      error: null,
    });

    const previewButton = await screen.findByRole('button', {
      name: /open latest reply/i,
    });
    fireEvent.click(previewButton);

    expect(await screen.findByPlaceholderText(/ask moxxy|no active workspace/i)).toBeTruthy();
    expect(screen.getByText(/question behind the clickable reply/i)).toBeTruthy();
    expect(screen.getByText(/clickable preview reply/i)).toBeTruthy();
  });

  it('opens mini-text from a reply bubble while Voice Mode is active', async () => {
    configurePlatform({
      audioCapture: {
        isSupported: () => true,
        start: async () => ({ stop: vi.fn(), cancel: vi.fn() }),
      },
    });
    const spy = installFakeApi();
    render(<FocusWidget />);

    fireEvent.click(screen.getByRole('button', { name: /click to expand/i }));
    fireEvent.click(await screen.findByRole('button', { name: /start voice mode/i }));
    await screen.findByRole('button', { name: /end voice mode/i });

    spy.emit('runner.turn.started', {
      workspaceId: 'ws-test',
      turnId: asTurnId('t-voice-preview-click'),
    });
    spy.emit('runner.event', {
      workspaceId: 'ws-test',
      event: event(22, {
        type: 'user_prompt',
        source: 'user',
        turnId: asTurnId('t-voice-preview-click'),
        text: 'Voice question behind the reply',
      }),
    });
    spy.emit('runner.event', {
      workspaceId: 'ws-test',
      event: event(23, {
        type: 'assistant_chunk',
        turnId: asTurnId('t-voice-preview-click'),
        delta: 'Voice reply opens the mini chat',
      }),
    });
    spy.emit('runner.event', {
      workspaceId: 'ws-test',
      event: event(24, {
        type: 'assistant_message',
        source: 'model',
        turnId: asTurnId('t-voice-preview-click'),
        content: 'Voice reply opens the mini chat',
        stopReason: 'end_turn',
      }),
    });
    spy.emit('runner.turn.complete', {
      workspaceId: 'ws-test',
      turnId: asTurnId('t-voice-preview-click'),
      error: null,
    });

    fireEvent.click(await screen.findByRole('button', { name: /open latest reply/i }));

    expect(await screen.findByPlaceholderText(/ask moxxy|no active workspace/i)).toBeTruthy();
    expect(screen.getByText(/voice question behind the reply/i)).toBeTruthy();
    expect(screen.getByText(/voice reply opens the mini chat/i)).toBeTruthy();
  });

  it('shows assistant preview above the active controls', async () => {
    const spy = installFakeApi();
    render(<FocusWidget />);

    fireEvent.click(screen.getByRole('button', { name: /click to expand/i }));

    spy.emit('runner.event', {
      workspaceId: 'ws-test',
      event: {
        id: 'e-active-preview',
        seq: 22,
        ts: 22,
        sessionId: 's-test',
        type: 'assistant_chunk',
        turnId: 't-active-preview',
        delta: 'reply while controls are open',
      } as MoxxyEvent,
    });

    expect(await screen.findByRole('button', { name: /open latest reply/i }))
      .toHaveTextContent(/reply while controls are open/i);
    expect(screen.getByRole('button', { name: /^text$/i })).toBeTruthy();

    await waitFor(() => {
      const previewResize = spy.invokes.find(
        (i) =>
          i.channel === 'focus.resize' &&
          (i.args as { width: number; height: number }).height === 190,
      );
      expect(previewResize).toBeTruthy();
      assertDefined(previewResize, 'focus.resize preview invoke');
      expect(previewResize.args).toMatchObject({ verticalAnchor: 'bottom' });
    });
  });

  it('keeps long assistant preview text scrollable instead of truncating it', async () => {
    const spy = installFakeApi();
    render(<FocusWidget />);

    spy.emit('runner.event', {
      workspaceId: 'ws-test',
      event: {
        id: 'e-scrollable-preview',
        seq: 23,
        ts: 23,
        sessionId: 's-test',
        type: 'assistant_chunk',
        turnId: 't-scrollable-preview',
        delta:
          'To jest długa odpowiedź do dymku focus mode, która ma wystarczająco dużo tekstu, żeby przekroczyć kilka linii i wymusić przewijanie w obrębie samego dymku zamiast ucinania treści po kilku zdaniach. Finalny fragment do przewijania musi nadal być dostępny w treści.',
      } as MoxxyEvent,
    });

    const previewButton = await screen.findByRole('button', {
      name: /open latest reply/i,
    });
    expect(previewButton.textContent).toContain('Finalny fragment do przewijania');
    expect(previewButton.textContent?.endsWith('...')).toBe(false);
    expect(previewButton.getAttribute('style')).toContain('max-height: 84px');
    expect(previewButton.getAttribute('style')).toContain('overflow-y: auto');
  });

  it('reserves enough window height for a three-line inactive preview', async () => {
    const spy = installFakeApi();
    render(<FocusWidget />);

    spy.emit('runner.event', {
      workspaceId: 'ws-test',
      event: {
        id: 'e-preview-height',
        seq: 24,
        ts: 24,
        sessionId: 's-test',
        type: 'assistant_chunk',
        turnId: 't-preview-height',
        delta:
          'Tak — jest kilka sensownych sposobów na tworzenie napisów w locie, zależnie od tego, czy chodzi Ci o szybki podgląd czy finalny eksport.',
      } as MoxxyEvent,
    });

    expect(await screen.findByRole('button', { name: /open latest reply/i }))
      .toHaveTextContent(/tworzenie napisów/i);

    await waitFor(() => {
      const previewResize = spy.invokes.find(
        (i) =>
          i.channel === 'focus.resize' &&
          (i.args as { width: number; height: number }).height === 190,
      );
      expect(previewResize).toBeTruthy();
      assertDefined(previewResize, 'focus.resize preview invoke');
      expect(previewResize.args).toMatchObject({ verticalAnchor: 'bottom' });
    });
  });

  it('keeps the inactive preview window size stable while assistant chunks stream', async () => {
    const spy = installFakeApi();
    render(<FocusWidget />);

    spy.emit('runner.event', {
      workspaceId: 'ws-test',
      event: {
        id: 'e-preview-1',
        seq: 21,
        ts: 21,
        sessionId: 's-test',
        type: 'assistant_chunk',
        turnId: 't-preview-size',
        delta: 'first live chunk',
      } as MoxxyEvent,
    });

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /open latest reply/i }))
        .toHaveTextContent(/first live chunk/i);
    });

    const resizeCountAfterFirstPreview = spy.invokes.filter(
      (i) => i.channel === 'focus.resize',
    ).length;

    spy.emit('runner.event', {
      workspaceId: 'ws-test',
      event: {
        id: 'e-preview-2',
        seq: 22,
        ts: 22,
        sessionId: 's-test',
        type: 'assistant_chunk',
        turnId: 't-preview-size',
        delta: ' and second live chunk',
      } as MoxxyEvent,
    });

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /open latest reply/i }))
        .toHaveTextContent(/first live chunk and second live chunk/i);
    });

    const resizeCountAfterSecondPreview = spy.invokes.filter(
      (i) => i.channel === 'focus.resize',
    ).length;
    expect(resizeCountAfterSecondPreview).toBe(resizeCountAfterFirstPreview);
  });

  it('shows the active task above Moxxy and keeps the native window bottom-anchored', async () => {
    const spy = installFakeApi();
    render(<FocusWidget />);

    act(() => {
      spy.emit('runner.turn.started', {
        workspaceId: 'ws-test',
        turnId: asTurnId('turn-focus-task'),
      });
      spy.emit('runner.event', {
        workspaceId: 'ws-test',
        event: event(30, {
          type: 'user_prompt',
          source: 'user',
          turnId: asTurnId('turn-focus-task'),
          text: 'Dodaj dymek aktywnego zadania nad Moxxy',
        }),
      });
    });

    const status = await screen.findByRole('status', { name: /current task/i });
    expect(status).toHaveTextContent('Moxxy');
    expect(status).toHaveTextContent('Dodaj dymek aktywnego zadania nad Moxxy');

    await waitFor(() => {
      const resize = spy.invokes.find(
        (invoke) => invoke.channel === 'focus.resize'
          && (invoke.args as { height?: number }).height === 190,
      );
      expect(resize).toBeTruthy();
      assertDefined(resize, 'focus.resize task bubble invoke');
      expect(resize.args).toMatchObject({ verticalAnchor: 'bottom' });
    });
  });

  it('lets the user hide and restore task bubbles without ending the turn', async () => {
    const spy = installFakeApi();
    render(<FocusWidget />);

    act(() => {
      spy.emit('runner.turn.started', {
        workspaceId: 'ws-test',
        turnId: asTurnId('turn-hide-task'),
      });
      spy.emit('runner.event', {
        workspaceId: 'ws-test',
        event: event(31, {
          type: 'user_prompt',
          source: 'user',
          turnId: asTurnId('turn-hide-task'),
          text: 'Keep this task running',
        }),
      });
    });

    await screen.findByText('Keep this task running');
    fireEvent.click(screen.getByRole('button', { name: /hide task status/i }));

    expect(screen.queryByText('Keep this task running')).toBeNull();
    const restore = screen.getByRole('button', { name: /show task status/i });
    expect(restore.getAttribute('style')).not.toContain('position: absolute');
    expect(restore.parentElement?.style.flexDirection).toBe('row');
    expect(chatStore.getChat('ws-test').activeTurnId).toBe('turn-hide-task');

    await waitFor(() => {
      expect(spy.invokes.some((invoke) => (
        invoke.channel === 'focus.resize'
        && Number((invoke.args as { width?: number; height?: number }).width) > 84
        && (invoke.args as { width?: number; height?: number }).height === 104
      ))).toBe(true);
    });

    fireEvent.click(restore);
    expect(await screen.findByText('Keep this task running')).toBeTruthy();
  });

  it('keeps the inactive restore control inward when Focus is docked on the left', async () => {
    const spy = installFakeApi({ horizontalAnchor: 'left' });
    render(<FocusWidget />);

    act(() => {
      spy.emit('runner.turn.started', {
        workspaceId: 'ws-test',
        turnId: asTurnId('turn-left-restore'),
      });
      spy.emit('runner.event', {
        workspaceId: 'ws-test',
        event: event(35, {
          type: 'user_prompt',
          source: 'user',
          turnId: asTurnId('turn-left-restore'),
          text: 'Keep restore control inward',
        }),
      });
    });

    await screen.findByText('Keep restore control inward');
    fireEvent.click(screen.getByRole('button', { name: /hide task status/i }));

    const restore = screen.getByRole('button', { name: /show task status/i });
    await waitFor(() => expect(restore.parentElement?.style.flexDirection).toBe('row-reverse'));
    expect(spy.invokes.some((invoke) => (
      invoke.channel === 'focus.resize'
      && (invoke.args as { width?: number; height?: number }).width === 120
      && (invoke.args as { width?: number; height?: number }).height === 104
    ))).toBe(true);
  });

  it('keeps the active restore arrow above Moxxy and outside the action bar', async () => {
    const spy = installFakeApi();
    render(<FocusWidget />);

    fireEvent.click(screen.getByRole('button', { name: /click to expand/i }));
    act(() => {
      spy.emit('runner.turn.started', {
        workspaceId: 'ws-test',
        turnId: asTurnId('turn-active-restore'),
      });
      spy.emit('runner.event', {
        workspaceId: 'ws-test',
        event: event(36, {
          type: 'user_prompt',
          source: 'user',
          turnId: asTurnId('turn-active-restore'),
          text: 'Keep the active restore control near Moxxy',
        }),
      });
    });

    await screen.findByText('Keep the active restore control near Moxxy');
    fireEvent.click(screen.getByRole('button', { name: /hide task status/i }));

    const restore = screen.getByRole('button', { name: /show task status/i });
    const restoreDock = screen.getByTestId('focus-active-restore-dock');
    const actions = screen.getByTestId('focus-active-actions');
    expect(restoreDock).toContainElement(restore);
    expect(actions).not.toContainElement(restore);
    expect(restoreDock.getAttribute('style')).toContain('position: absolute');
    expect(restoreDock.getAttribute('style')).toContain('top: 0');

    await waitFor(() => {
      expect(spy.invokes.some((invoke) => (
        invoke.channel === 'focus.resize'
        && (invoke.args as { height?: number }).height === 126
      ))).toBe(true);
    });
  });

  it('places the main-window action before the close action', async () => {
    installFakeApi();
    render(<FocusWidget />);

    fireEvent.click(screen.getByRole('button', { name: /click to expand/i }));
    const actions = screen.getByTestId('focus-active-actions');
    const openMain = within(actions).getByRole('button', { name: /open main window/i });
    const close = within(actions).getByRole('button', { name: /close focus mode/i });

    expect(openMain.nextElementSibling).toBe(close);
  });

  it('lets the user dismiss a final reply with X without restoring the completed task', async () => {
    const spy = installFakeApi();
    render(<FocusWidget />);

    act(() => {
      spy.emit('runner.turn.started', {
        workspaceId: 'ws-test',
        turnId: asTurnId('turn-final-reply'),
      });
      spy.emit('runner.event', {
        workspaceId: 'ws-test',
        event: event(40, {
          type: 'user_prompt',
          source: 'user',
          turnId: asTurnId('turn-final-reply'),
          text: 'Finish this task',
        }),
      });
      spy.emit('runner.event', {
        workspaceId: 'ws-test',
        event: event(41, {
          type: 'assistant_chunk',
          turnId: asTurnId('turn-final-reply'),
          delta: 'The task is complete.',
        }),
      });
      spy.emit('runner.event', {
        workspaceId: 'ws-test',
        event: event(42, {
          type: 'assistant_message',
          source: 'model',
          turnId: asTurnId('turn-final-reply'),
          content: 'The task is complete.',
          stopReason: 'end_turn',
        }),
      });
      spy.emit('runner.turn.complete', {
        workspaceId: 'ws-test',
        turnId: asTurnId('turn-final-reply'),
        error: null,
      });
    });

    expect(await screen.findByText('The task is complete.')).toBeTruthy();
    const dismiss = screen.getByRole('button', { name: /dismiss latest reply/i });
    expect(dismiss.getAttribute('style')).toContain('top: 10px');
    expect(dismiss.getAttribute('style')).not.toContain('bottom:');
    fireEvent.click(dismiss);

    expect(screen.queryByText('The task is complete.')).toBeNull();
    expect(screen.queryByText('Finish this task')).toBeNull();
    expect(screen.queryByRole('button', { name: /show task status/i })).toBeNull();
  });

  it('keeps required user decisions visible while ordinary task bubbles are hidden', async () => {
    const spy = installFakeApi();
    render(<FocusWidget />);

    act(() => {
      spy.emit('runner.turn.started', {
        workspaceId: 'ws-test',
        turnId: asTurnId('turn-hidden-task-ask'),
      });
      spy.emit('runner.event', {
        workspaceId: 'ws-test',
        event: event(32, {
          type: 'user_prompt',
          source: 'user',
          turnId: asTurnId('turn-hidden-task-ask'),
          text: 'Run the required command',
        }),
      });
    });

    await screen.findByText('Run the required command');
    fireEvent.click(screen.getByRole('button', { name: /hide task status/i }));
    act(() => spy.emit('ask.request', permissionAsk('ask-visible-over-hidden-task')));

    expect(await screen.findByRole('group', { name: /permission required/i })).toBeTruthy();
    expect(screen.getByText(/pnpm build/i)).toBeTruthy();
  });

  it('shows a pending permission as an inactive focus toast and answers from it', async () => {
    const spy = installFakeApi();
    render(<FocusWidget />);

    spy.emit('ask.request', permissionAsk('ask-focus-toast'));

    await screen.findByRole('group', { name: /permission required/i });
    expect(screen.getByText(/bash/i)).toBeTruthy();
    expect(screen.getByText(/pnpm build/i)).toBeTruthy();

    await waitFor(() => {
      const askResize = spy.invokes.find(
        (i) =>
          i.channel === 'focus.resize' &&
          (i.args as { width: number; height: number }).width >= 520,
      );
      expect(askResize).toBeTruthy();
      assertDefined(askResize, 'focus.resize ask invoke');
      expect((askResize.args as { height: number }).height).toBeGreaterThanOrEqual(130);
    });

    fireEvent.click(screen.getByRole('button', { name: /^allow$/i }));

    await waitFor(() => {
      const respond = spy.invokes.find((i) => i.channel === 'ask.respond');
      expect(respond).toBeTruthy();
      assertDefined(respond, 'ask.respond invoke');
      expect(respond.args).toEqual({
        requestId: 'ask-focus-toast',
        response: { mode: 'allow_session' },
      });
    });
  });

  it('keeps the inactive sidecar gutter transparent behind permission cards', async () => {
    const spy = installFakeApi();
    render(<FocusWidget />);

    spy.emit('ask.request', permissionAsk('ask-focus-transparent-gutter'));

    const card = await screen.findByRole('group', { name: /permission required/i });
    expect(card.parentElement?.getAttribute('style')).toContain('background: transparent');
    expect(focusStyle.inactiveRootWithPreview).toMatchObject({
      background: 'transparent',
    });
  });

  it('renders permission body markdown instead of showing raw markdown markers', async () => {
    const spy = installFakeApi();
    render(<FocusWidget />);

    spy.emit('ask.request', {
      ...permissionAsk('ask-focus-markdown'),
      tool: {
        name: 'Bash',
        description: 'Run **trusted checks** before continuing.\n\n- Verify build output',
        input: { command: 'pnpm build' },
      },
    });

    const card = await screen.findByRole('group', { name: /permission required/i });
    expect(card.textContent).not.toContain('**trusted checks**');
    expect(within(card).getByText('trusted checks').tagName.toLowerCase()).toBe('strong');
    expect(within(card).getByText('Verify build output').closest('li')).toBeTruthy();
  });

  it('keeps a pending permission visible inside mini-text until it is answered', async () => {
    const spy = installFakeApi();
    render(<FocusWidget />);

    spy.emit('ask.request', permissionAsk('ask-focus-mini'));

    await screen.findByRole('group', { name: /permission required/i });
    fireEvent.click(screen.getByRole('button', { name: /click to expand/i }));
    fireEvent.click(screen.getByRole('button', { name: /^text$/i }));

    await waitFor(() => {
      expect(screen.getByPlaceholderText(/ask moxxy|no active workspace/i)).toBeTruthy();
    });
    expect(screen.getByRole('group', { name: /permission required/i })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /always allow/i }));

    await waitFor(() => {
      const respond = spy.invokes.find((i) => i.channel === 'ask.respond');
      expect(respond).toBeTruthy();
      assertDefined(respond, 'ask.respond invoke');
      expect(respond.args).toEqual({
        requestId: 'ask-focus-mini',
        response: { mode: 'allow_always' },
      });
    });
  });

  it('reserves enough active-toast height for permission details and action buttons', async () => {
    const spy = installFakeApi();
    render(<FocusWidget />);

    fireEvent.click(screen.getByRole('button', { name: /click to expand/i }));
    spy.emit('ask.request', {
      ...permissionAsk('ask-focus-tall-toast'),
      tool: {
        name: 'nutrition_search_usda',
        description:
          'Search USDA FoodData Central for generic ingredients and return verified nutrition data.',
        input: {
          query: 'chicken breast cooked roasted skinless with rice and vegetables',
          pageSize: 3,
        },
      },
    });

    await screen.findByRole('group', { name: /permission required/i });
    expect(screen.getByRole('button', { name: /^deny$/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /^allow$/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /always allow/i })).toBeTruthy();

    await waitFor(() => {
      const askResize = spy.invokes.find(
        (i) =>
          i.channel === 'focus.resize' &&
          (i.args as { width: number; height: number }).width >= 600,
      );
      expect(askResize).toBeTruthy();
      assertDefined(askResize, 'focus.resize ask invoke');
      expect((askResize.args as { height: number }).height).toBeGreaterThanOrEqual(210);
    });
  });

  it('keeps enough markdown body space above permission details', () => {
    expect(Number(focusStyle.focusAskBody.maxHeight)).toBeGreaterThanOrEqual(66);
    expect(Number.parseInt(String(focusStyle.focusAskDetail.margin), 10)).toBeGreaterThanOrEqual(9);
  });
});
