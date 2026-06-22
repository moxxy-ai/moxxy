/**
 * Regression test for the mic-leak fix: the voice recorder lives on the
 * always-mounted Surface, so collapsing the active pill back to the inactive
 * square (which hides the recording UI) must STOP an in-flight recording — not
 * leave the microphone capturing with no visible indicator (a privacy leak).
 */
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import {
  __setApiOverride,
  chatStore,
  configurePlatform,
  type PlatformCapabilities,
} from '@moxxy/client-core';
import { FocusWidget } from './FocusWidget';

interface RecorderProbe {
  readonly stop: ReturnType<typeof vi.fn>;
  starts: number;
}

function installAudioCapture(probe: RecorderProbe): void {
  const platform: PlatformCapabilities = {
    audioCapture: {
      isSupported: () => true,
      start: async () => {
        probe.starts += 1;
        // A handle whose stop() we can observe. We never fire onResult, so the
        // recorder stays in the 'recording' phase until someone calls stop().
        return { stop: probe.stop };
      },
    },
  };
  configurePlatform(platform);
}

function installFakeApi(): void {
  __setApiOverride({
    invoke: ((channel: string) => {
      if (channel === 'connection.snapshotAll') {
        return Promise.resolve([
          { workspaceId: 'ws-mic', phase: { phase: 'connected' }, cliPath: null, attempts: 0, log: [] },
        ]);
      }
      if (channel === 'connection.activeWorkspace') return Promise.resolve('ws-mic');
      if (channel === 'session.hasTranscriber') return Promise.resolve(true);
      return Promise.resolve(undefined);
    }) as never,
    subscribe: (() => () => undefined) as never,
  } as never);
}

beforeEach(() => {
  chatStore.clear('ws-mic');
});

afterEach(() => {
  __setApiOverride(null);
  configurePlatform({});
});

describe('FocusWidget microphone leak guard', () => {
  it('stops an in-flight recording when collapsing to the inactive square', async () => {
    const probe: RecorderProbe = { stop: vi.fn(), starts: 0 };
    installAudioCapture(probe);
    installFakeApi();
    render(<FocusWidget />);

    // inactive → active
    fireEvent.click(screen.getByRole('button', { name: /click to expand/i }));

    // Start recording.
    const mic = await screen.findByRole('button', { name: /^record voice$/i });
    fireEvent.click(mic);

    // The recorder must have actually started before we assert the teardown.
    await waitFor(() => expect(probe.starts).toBe(1));

    // Collapse back to the inactive square — the recording must be stopped.
    fireEvent.click(screen.getByRole('button', { name: /^collapse$/i }));
    expect(probe.stop).toHaveBeenCalledTimes(1);

    // And the widget really did collapse (no recording UI lingering).
    expect(screen.getByRole('button', { name: /click to expand/i })).toBeTruthy();
  });

  it('does not call stop() on collapse when not recording', () => {
    const probe: RecorderProbe = { stop: vi.fn(), starts: 0 };
    installAudioCapture(probe);
    installFakeApi();
    render(<FocusWidget />);

    fireEvent.click(screen.getByRole('button', { name: /click to expand/i }));
    // Collapse without ever recording.
    fireEvent.click(screen.getByRole('button', { name: /^collapse$/i }));
    expect(probe.stop).not.toHaveBeenCalled();
  });
});
