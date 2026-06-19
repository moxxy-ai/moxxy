/**
 * UpdateSection — the "Copy diagnostics" button must not swallow a clipboard
 * rejection. In a packaged renderer the Clipboard API can reject (permission /
 * focus / insecure-context); the old `.catch(() => undefined)` left the user
 * believing the copy worked. The button now surfaces the failure so they know
 * to select the log text and copy it manually.
 */

import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { __setApiOverride } from '@moxxy/client-core';
import type { AppUpdateDiagnostics } from '@moxxy/desktop-ipc-contract';
import { UpdateSection } from './UpdateSection';

const DIAGNOSTICS: AppUpdateDiagnostics = {
  running: '0.12.0',
  active: '0.12.0',
  confirmed: '0.12.0',
  bad: [],
  staged: ['0.12.0'],
  log: [{ ts: Date.now(), phase: 'boot', picked: 'override' }],
};

/** Install a fake transport that answers the handful of IPC calls UpdateSection
 *  makes on mount plus the diagnostics fetch triggered by opening the details
 *  disclosure. Everything else resolves undefined. */
function installFakeApi(): void {
  __setApiOverride({
    invoke: ((channel: string) => {
      if (channel === 'app.updateInfo') {
        return Promise.resolve({ version: '0.12.0', source: 'bundled', channelConfigured: true });
      }
      if (channel === 'app.cliInfo') return Promise.resolve({ version: '0.12.0', path: '/x' });
      if (channel === 'app.updateDiagnostics') return Promise.resolve(DIAGNOSTICS);
      return Promise.resolve(undefined);
    }) as never,
    subscribe: (() => () => undefined) as never,
  } as never);
}

beforeEach(() => {
  installFakeApi();
});

afterEach(() => {
  __setApiOverride(null);
});

async function openDiagnostics(): Promise<void> {
  // The diagnostics (and the Copy button) live behind a "Get more details"
  // disclosure that lazy-loads on toggle.
  const summary = await screen.findByText(/get more details/i);
  // jsdom doesn't fire the native <details> toggle from a summary click; open it
  // directly and dispatch the toggle the component listens for.
  const details = summary.closest('details') as HTMLDetailsElement;
  details.open = true;
  fireEvent(details, new Event('toggle'));
}

describe('UpdateSection diagnostics copy', () => {
  it('surfaces a clipboard rejection instead of swallowing it', async () => {
    Object.assign(navigator, {
      clipboard: { writeText: () => Promise.reject(new Error('not allowed')) },
    });
    render(<UpdateSection />);
    await openDiagnostics();

    const copy = await screen.findByTestId('copy-diagnostics');
    fireEvent.click(copy);

    await waitFor(() => {
      expect(screen.getByTestId('copy-diagnostics-failed').textContent).toMatch(/copy failed/i);
    });
  });

  it('confirms a successful copy without claiming failure', async () => {
    const writes: string[] = [];
    Object.assign(navigator, {
      clipboard: {
        writeText: (t: string) => {
          writes.push(t);
          return Promise.resolve();
        },
      },
    });
    render(<UpdateSection />);
    await openDiagnostics();

    const copy = await screen.findByTestId('copy-diagnostics');
    fireEvent.click(copy);

    await waitFor(() => {
      expect(screen.getByTestId('copy-diagnostics').textContent).toMatch(/copied/i);
    });
    expect(screen.queryByTestId('copy-diagnostics-failed')).toBeNull();
    // The actual diagnostics JSON was written, not some stale value.
    expect(writes[0]).toContain('"running": "0.12.0"');
  });
});
