import { describe, expect, it, vi } from 'vitest';
import type { App } from 'electron';
import { DESKTOP_APP_HOST } from '@moxxy/desktop-host';
import { RENDERER_HOST, pinRendererHostToLoopback } from './renderer-host.js';

const fakeApp = (existing = ''): { app: App; switches: Array<[string, string]> } => {
  const switches: Array<[string, string]> = [];
  return {
    switches,
    app: {
      commandLine: {
        getSwitchValue: () => existing,
        appendSwitch: (k: string, v: string) => switches.push([k, v]),
      },
    } as unknown as App,
  };
};

describe('renderer host pinning', () => {
  it('matches the host the loopback server actually serves', () => {
    // The literal is duplicated into the floor to keep a heavy import out of
    // the bootstrap prologue. Drift would mean the app maps one name and
    // requests another, which is precisely the blank window this prevents.
    expect(RENDERER_HOST).toBe(DESKTOP_APP_HOST);
  });

  it('maps the renderer host to loopback so no DNS lookup is needed', () => {
    const { app, switches } = fakeApp();

    pinRendererHostToLoopback(app);

    expect(switches).toEqual([['host-resolver-rules', 'MAP desktop.moxxy.ai 127.0.0.1']]);
  });

  it('keeps an operator-supplied rule instead of overwriting it', () => {
    const { app, switches } = fakeApp('MAP api.internal 10.0.0.5');

    pinRendererHostToLoopback(app);

    expect(switches[0]?.[1]).toBe('MAP api.internal 10.0.0.5,MAP desktop.moxxy.ai 127.0.0.1');
  });

  it('maps only the renderer host, never a wildcard', () => {
    const { app, switches } = fakeApp();

    pinRendererHostToLoopback(app);

    // A blanket MAP * would silently reroute every request the app makes.
    expect(switches[0]?.[1]).not.toContain('*');
  });
});
