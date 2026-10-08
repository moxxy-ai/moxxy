import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { __setApiOverride } from '@moxxy/client-core';
import { __resetReplySoundForTests } from '@/attention/useReplySoundPreference';
import { __resetSystemNotificationsForTests } from '@/attention/useSystemNotificationsPreference';
import { PreferencesTab } from './PreferencesTab';

afterEach(() => {
  cleanup();
  __resetReplySoundForTests();
  __resetSystemNotificationsForTests();
  __setApiOverride(null);
});

describe('PreferencesTab', () => {
  it('leaves the Voice Mode engine to Settings → Voice', () => {
    // Desktop IPC to the main process is the one boundary stood in here.
    __setApiOverride({
      invoke: (async () => undefined) as never,
      subscribe: (() => () => undefined) as never,
    } as never);

    render(<PreferencesTab />);

    expect(screen.getByText('Theme')).toBeTruthy();
    expect(screen.queryByTestId('voice-engine-local')).toBeNull();
    expect(screen.queryByText('Voice engine')).toBeNull();
  });

  it('lets the sound for a chat that needs you be switched off', () => {
    const calls: Array<[string, unknown]> = [];
    __setApiOverride({
      invoke: (async (name: string, args: unknown) => {
        calls.push([name, args]);
        return name === 'prefs.read' ? {} : undefined;
      }) as never,
      subscribe: (() => () => undefined) as never,
    } as never);
    render(<PreferencesTab />);

    const sound = screen.getByRole('switch', { name: 'Sound when a chat needs you' });
    expect(sound).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(sound);

    expect(sound).toHaveAttribute('aria-checked', 'false');
    expect(calls).toContainEqual(['prefs.update', { replySound: false }]);
  });

  it('lets the system notification be switched off on its own', () => {
    const calls: Array<[string, unknown]> = [];
    __setApiOverride({
      invoke: (async (name: string, args: unknown) => {
        calls.push([name, args]);
        return name === 'prefs.read' ? {} : undefined;
      }) as never,
      subscribe: (() => () => undefined) as never,
    } as never);
    render(<PreferencesTab />);

    const banner = screen.getByRole('switch', { name: 'System notification when a chat needs you' });
    expect(banner).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(banner);

    expect(banner).toHaveAttribute('aria-checked', 'false');
    expect(calls).toContainEqual(['prefs.update', { systemNotifications: false }]);
    expect(screen.getByRole('switch', { name: 'Sound when a chat needs you' })).toHaveAttribute('aria-checked', 'true');
  });
});
