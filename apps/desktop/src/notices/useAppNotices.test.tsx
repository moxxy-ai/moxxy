import { act, cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { __setApiOverride } from '@moxxy/client-core';
import type { AppNotice, AppPresence } from '@moxxy/desktop-ipc-contract';
import type { Banner } from '../attention/show-banner';
import {
  __resetSystemNotificationsForTests,
  setSystemNotificationsPreference,
} from '../attention/useSystemNotificationsPreference';
import type { SectionTarget } from '../shell/navigation/places';
import { __resetToastsForTests, getToasts } from './toast-store';
import { __resetInAppToastsForTests, setInAppToastsPreference } from './useInAppToastsPreference';
import { useAppNotices } from './useAppNotices';

/**
 * The toast store is the real one. Stood in for: the main process behind IPC
 * (it sends the notice and alone knows which window has the keyboard) and the
 * system's notification centre (`show`).
 */

const READY: AppNotice = {
  id: 'transcription.local',
  tone: 'success',
  title: 'Local transcription is ready',
  body: 'Whisper turbo now turns your speech into text on this computer.',
  target: { destination: 'settings', section: 'voice' },
};

let presence: AppPresence;
let deliver: (notice: AppNotice) => void = () => undefined;

beforeEach(() => {
  presence = { focused: 'main', widgetOpen: false };
  __setApiOverride({
    invoke: vi.fn(async (command: string) => (command === 'window.presence' ? presence : undefined)),
    subscribe: (channel: string, handler: (notice: AppNotice) => void) => {
      if (channel === 'app.notice') deliver = handler;
      return () => undefined;
    },
  } as never);
});

afterEach(() => {
  cleanup();
  __setApiOverride(null);
  __resetToastsForTests();
  __resetSystemNotificationsForTests();
  __resetInAppToastsForTests();
});

function Probe({ onOpen, show }: { onOpen: (target: SectionTarget) => void; show: (banner: Banner) => void }): null {
  useAppNotices({ onOpen, show });
  return null;
}

describe('useAppNotices', () => {
  it('shows a toast while the main window is in front, opening what it is about', async () => {
    const onOpen = vi.fn();
    const show = vi.fn();
    render(<Probe onOpen={onOpen} show={show} />);

    act(() => deliver(READY));

    await waitFor(() => expect(getToasts()).toHaveLength(1));
    const toast = getToasts()[0]!;
    expect(toast).toMatchObject({ id: READY.id, tone: 'success', title: READY.title, body: READY.body });
    toast.onOpen?.();
    expect(onOpen).toHaveBeenCalledWith({ destination: 'settings', section: 'voice' });
    expect(show).not.toHaveBeenCalled();
  });

  it('hands the notice to the system while the app is in the background', async () => {
    presence = { focused: null, widgetOpen: false };
    const onOpen = vi.fn();
    const show = vi.fn();
    render(<Probe onOpen={onOpen} show={show} />);

    act(() => deliver(READY));

    await waitFor(() => expect(show).toHaveBeenCalledOnce());
    const banner = show.mock.calls[0]![0] as Banner;
    expect(banner).toMatchObject({ title: READY.title, body: READY.body, tag: READY.id });
    banner.onOpen();
    expect(onOpen).toHaveBeenCalledWith({ destination: 'settings', section: 'voice' });
    expect(getToasts()).toEqual([]);
  });

  it('stays quiet in the background when system notifications are off', async () => {
    presence = { focused: null, widgetOpen: false };
    setSystemNotificationsPreference(false);
    const show = vi.fn();
    render(<Probe onOpen={vi.fn()} show={show} />);

    act(() => deliver(READY));

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(show).not.toHaveBeenCalled();
    expect(getToasts()).toEqual([]);
  });

  it('shows nothing in the app once in-app toasts are switched off, and no system notification either', async () => {
    setInAppToastsPreference(false);
    const show = vi.fn();
    render(<Probe onOpen={vi.fn()} show={show} />);

    act(() => deliver(READY));

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(getToasts()).toEqual([]);
    expect(show).not.toHaveBeenCalled();
  });

  it('still hands a notice to the system in the background when only in-app toasts are off', async () => {
    presence = { focused: null, widgetOpen: false };
    setInAppToastsPreference(false);
    const show = vi.fn();
    render(<Probe onOpen={vi.fn()} show={show} />);

    act(() => deliver(READY));

    await waitFor(() => expect(show).toHaveBeenCalledOnce());
  });

  it('shows a notice that points at no known place without a way to open it', async () => {
    render(<Probe onOpen={vi.fn()} show={vi.fn()} />);

    act(() => deliver({ ...READY, target: { destination: 'settings', section: 'no-such-tab' } }));

    await waitFor(() => expect(getToasts()).toHaveLength(1));
    expect(getToasts()[0]!.onOpen).toBeUndefined();
  });
});
