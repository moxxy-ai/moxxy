/**
 * useTheme controller tests:
 *   1. A persisted `dark` pref sets <html data-theme="dark"> after mount.
 *   2. A persisted `light` pref leaves/clears the attribute.
 *   3. `system` follows the prefers-color-scheme media query, live.
 *   4. setThemePreference flips the DOM synchronously and persists via
 *      prefs.update.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, waitFor, act } from '@testing-library/react';
import { __setApiOverride } from '@moxxy/client-core';
import type { ThemePreference } from '@moxxy/desktop-ipc-contract';
import {
  useTheme,
  setThemePreference,
  isEffectiveDark,
  __resetThemeForTests,
} from './useTheme';

interface FakeMedia {
  matches: boolean;
  fire: () => void;
}

/** Install a controllable matchMedia('(prefers-color-scheme: dark)'). */
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

function installFakeApi(theme: ThemePreference): Array<{ channel: string; args: unknown }> {
  const invokes: Array<{ channel: string; args: unknown }> = [];
  __setApiOverride({
    invoke: ((channel: string, args: unknown) => {
      invokes.push({ channel, args });
      if (channel === 'prefs.read') return Promise.resolve({ theme });
      if (channel === 'prefs.update') return Promise.resolve({ theme: (args as { theme: ThemePreference }).theme });
      return Promise.resolve(undefined);
    }) as never,
    subscribe: (() => () => undefined) as never,
  } as never);
  return invokes;
}

function Probe(): JSX.Element {
  useTheme();
  return <div />;
}

const themeAttr = (): string | undefined => document.documentElement.dataset.theme;

beforeEach(() => {
  __resetThemeForTests();
});

afterEach(() => {
  __setApiOverride(null);
  __resetThemeForTests();
});

describe('useTheme', () => {
  it('applies a persisted dark pref to <html data-theme>', async () => {
    installMatchMedia(false);
    installFakeApi('dark');
    render(<Probe />);
    await waitFor(() => expect(themeAttr()).toBe('dark'));
  });

  it('keeps light mode attribute-free for a persisted light pref', async () => {
    installMatchMedia(true); // OS dark, but the explicit pref wins
    const invokes = installFakeApi('light');
    render(<Probe />);
    await waitFor(() => expect(invokes.some((i) => i.channel === 'prefs.read')).toBe(true));
    expect(themeAttr()).toBeUndefined();
  });

  it('system follows prefers-color-scheme, live', async () => {
    const media = installMatchMedia(false);
    installFakeApi('system');
    render(<Probe />);
    await waitFor(() => expect(isEffectiveDark()).toBe(false));
    expect(themeAttr()).toBeUndefined();

    media.matches = true;
    act(() => media.fire());
    expect(themeAttr()).toBe('dark');

    media.matches = false;
    act(() => media.fire());
    expect(themeAttr()).toBeUndefined();
  });

  it('setThemePreference flips the DOM synchronously and persists', async () => {
    installMatchMedia(false);
    const invokes = installFakeApi('light');
    render(<Probe />);
    await waitFor(() => expect(invokes.some((i) => i.channel === 'prefs.read')).toBe(true));

    act(() => setThemePreference('dark'));
    expect(themeAttr()).toBe('dark'); // synchronous, no round-trip needed
    await waitFor(() =>
      expect(invokes).toContainEqual({ channel: 'prefs.update', args: { theme: 'dark' } }),
    );

    act(() => setThemePreference('light'));
    expect(themeAttr()).toBeUndefined();
  });
});
