/**
 * The connection surface — focused on the TERMINAL protocol-incompatibility
 * phase (Part C of the runner-protocol-skew fix): it must render an actionable
 * "update the CLI" message and NOT offer a retry that would loop straight back
 * into the same dead end. Contrast with `reconnecting`, which keeps the retry.
 */
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { ConnectionSnapshot } from '@moxxy/desktop-ipc-contract';
import { ConnectionScreen } from './ConnectionScreen';

function snapshotWith(phase: ConnectionSnapshot['phase']): ConnectionSnapshot {
  return { phase, cliPath: null, attempts: 1, log: [] };
}

describe('ConnectionScreen — protocol-incompatible (terminal)', () => {
  it('renders the actionable hint and hides the retry button', () => {
    const onRetry = vi.fn();
    render(
      <ConnectionScreen
        snapshot={snapshotWith({
          phase: 'protocol-incompatible',
          serverVersion: 3,
          clientVersion: 4,
          detail: 'runner protocol mismatch: server v3, client v4',
          hint: 'This app version needs a newer moxxy CLI. Update the CLI (or reinstall the app) to continue.',
        })}
        onRetry={onRetry}
      />,
    );

    expect(screen.getByText(/update needed to continue/i)).toBeTruthy();
    // The actionable hint appears as the subtitle and again in the diagnostics.
    expect(screen.getAllByText(/needs a newer moxxy CLI/i).length).toBeGreaterThan(0);
    // No "Try again" — auto-retry into the same pinned CLI is a dead end.
    expect(screen.queryByRole('button', { name: /try again/i })).toBeNull();
  });
});

describe('ConnectionScreen — reconnecting (recoverable) keeps retrying', () => {
  it('still offers the retry button', () => {
    render(
      <ConnectionScreen
        snapshot={snapshotWith({ phase: 'reconnecting', reason: 'runner disconnected', attempt: 2 })}
        onRetry={vi.fn()}
      />,
    );
    expect(screen.getByRole('button', { name: /try again/i })).toBeTruthy();
  });
});
