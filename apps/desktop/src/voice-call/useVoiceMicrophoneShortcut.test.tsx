import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { __setApiOverride } from '@moxxy/client-core';
import type { MoxxyApi } from '@moxxy/desktop-ipc-contract';
import { useHotkeyDispatcher, useHotkeyList$ } from '../hotkeys/useHotkeys';
import { useAppHotkeys } from '../hotkeys/useAppHotkeys';
import {
  useFocusVoiceMicrophoneHotkey,
  useVoiceMicrophonePulse,
  type VoiceMicrophoneControl,
} from './useVoiceMicrophoneShortcut';

beforeEach(() => {
  __setApiOverride({
    invoke: vi.fn(async () => ({ desks: [], activeId: null })),
    subscribe: () => () => undefined,
  } as unknown as MoxxyApi);
});
afterEach(() => __setApiOverride(null));

/** The microphone as Voice Mode holds it: on or off, in a call or not. */
function useCall(active: boolean): VoiceMicrophoneControl {
  const [microphoneMuted, setMuted] = useState(false);
  return {
    active,
    microphoneMuted,
    muteMicrophone: () => setMuted(true),
    unmuteMicrophone: () => setMuted(false),
  };
}

function MicrophoneState({ call }: { readonly call: VoiceMicrophoneControl }): JSX.Element {
  return <p>{call.microphoneMuted ? 'microphone off' : 'microphone on'}</p>;
}

/** The main window: the shell's keymap, and the chat surface that owns the call. */
function MainWindow({ active = true }: { readonly active?: boolean }): JSX.Element {
  useHotkeyDispatcher();
  useAppHotkeys({
    setView: vi.fn(),
    onOpenPalette: vi.fn(),
    toggleBench: vi.fn(),
    toggleBenchFull: vi.fn(),
    onShowShortcuts: vi.fn(),
  });
  const call = useCall(active);
  useVoiceMicrophonePulse(call);
  return <MicrophoneState call={call} />;
}

/** The Focus Mode window: a renderer of its own, so it listens itself. */
function FocusWindow({ active = true }: { readonly active?: boolean }): JSX.Element {
  const call = useCall(active);
  useFocusVoiceMicrophoneHotkey(call);
  return <MicrophoneState call={call} />;
}

function Sheet(): JSX.Element {
  const binding = useHotkeyList$().find((b) => b.id === 'voice.microphone');
  return <p>{binding ? `${binding.group}: ${binding.label} (${binding.chord})` : 'not listed'}</p>;
}

describe('the microphone shortcut, main window', () => {
  it('turns the microphone off and on again with ⌘D during a call', () => {
    render(<MainWindow />);
    fireEvent.keyDown(window, { key: 'd', metaKey: true });
    expect(screen.getByText('microphone off')).toBeTruthy();
    fireEvent.keyDown(window, { key: 'd', metaKey: true });
    expect(screen.getByText('microphone on')).toBeTruthy();
  });

  it('answers Ctrl+D the same way, the chord on Windows', () => {
    render(<MainWindow />);
    fireEvent.keyDown(window, { key: 'd', ctrlKey: true });
    expect(screen.getByText('microphone off')).toBeTruthy();
  });

  it('works while the caret is in the message box', () => {
    render(
      <>
        <MainWindow />
        <textarea aria-label="message" />
      </>,
    );
    fireEvent.keyDown(screen.getByLabelText('message'), { key: 'd', metaKey: true });
    expect(screen.getByText('microphone off')).toBeTruthy();
  });

  it('does nothing with no call running', () => {
    render(<MainWindow active={false} />);
    fireEvent.keyDown(window, { key: 'd', metaKey: true });
    expect(screen.getByText('microphone on')).toBeTruthy();
  });

  it('is listed with the other shortcuts', () => {
    render(
      <>
        <MainWindow />
        <Sheet />
      </>,
    );
    expect(screen.getByText('Voice: Mute or unmute the microphone (mod+d)')).toBeTruthy();
  });
});

describe('the microphone shortcut, Focus Mode window', () => {
  it('turns the microphone off and on again with ⌘D during a call', () => {
    render(<FocusWindow />);
    fireEvent.keyDown(window, { key: 'd', metaKey: true });
    expect(screen.getByText('microphone off')).toBeTruthy();
    fireEvent.keyDown(window, { key: 'd', ctrlKey: true });
    expect(screen.getByText('microphone on')).toBeTruthy();
  });

  it('does nothing with no call running', () => {
    render(<FocusWindow active={false} />);
    fireEvent.keyDown(window, { key: 'd', metaKey: true });
    expect(screen.getByText('microphone on')).toBeTruthy();
  });
});
