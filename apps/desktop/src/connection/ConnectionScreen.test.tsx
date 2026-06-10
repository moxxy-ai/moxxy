/**
 * The connection surface — focused on the TERMINAL protocol-incompatibility
 * phase (Part C of the runner-protocol-skew fix): it must render an actionable
 * way to update the CLI and reconnect (the in-app self-heal) and NOT offer a
 * bare retry that would loop straight back into the same dead end. Contrast
 * with `reconnecting`, which keeps the retry.
 */
import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ConnectionSnapshot } from '@moxxy/desktop-ipc-contract';
import { ConnectionScreen, manualUpdateCommand } from './ConnectionScreen';

function snapshotWith(
  phase: ConnectionSnapshot['phase'],
  cliPath: string | null = null,
): ConnectionSnapshot {
  return { phase, cliPath, attempts: 1, log: [] };
}

const SERVER_OLDER = {
  phase: 'protocol-incompatible' as const,
  serverVersion: 4,
  clientVersion: 5,
  detail: 'runner protocol mismatch: server v4, client v5',
  hint: 'This app version needs a newer moxxy CLI. Update the CLI (or reinstall the app) to continue.',
};

describe('ConnectionScreen — protocol-incompatible (terminal)', () => {
  it('renders the actionable hint and hides the bare retry button', () => {
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

  it('offers "Update CLI & reconnect" when the runner is OLDER than the app', () => {
    render(
      <ConnectionScreen
        snapshot={snapshotWith(SERVER_OLDER)}
        onRetry={vi.fn()}
        onUpdateCli={vi.fn().mockResolvedValue({ ok: true })}
      />,
    );
    expect(
      screen.getByRole('button', { name: /update cli & reconnect/i }),
    ).toBeTruthy();
  });

  it('on click calls onUpdateCli and, on resolve, calls onRetry (via the handler)', async () => {
    const onRetry = vi.fn();
    // Mirror App.tsx: onUpdateCli triggers retry() before resolving { ok }.
    const onUpdateCli = vi.fn().mockImplementation(async () => {
      onRetry();
      return { ok: true };
    });
    const user = userEvent.setup();
    render(
      <ConnectionScreen
        snapshot={snapshotWith(SERVER_OLDER)}
        onRetry={onRetry}
        onUpdateCli={onUpdateCli}
      />,
    );

    await user.click(screen.getByRole('button', { name: /update cli & reconnect/i }));

    expect(onUpdateCli).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(onRetry).toHaveBeenCalledTimes(1));
  });

  it('shows an in-progress state while the update runs', async () => {
    let resolve!: (r: { ok: boolean }) => void;
    const onUpdateCli = vi.fn().mockReturnValue(
      new Promise<{ ok: boolean }>((r) => {
        resolve = r;
      }),
    );
    const user = userEvent.setup();
    render(
      <ConnectionScreen
        snapshot={snapshotWith(SERVER_OLDER)}
        onRetry={vi.fn()}
        onUpdateCli={onUpdateCli}
      />,
    );

    const btn = screen.getByRole('button', { name: /update cli & reconnect/i });
    await user.click(btn);

    // In-progress: button shows the updating label, is disabled + aria-busy.
    const busy = await screen.findByRole('button', { name: /updating the moxxy cli/i });
    expect(busy).toBeDisabled();
    expect(busy.getAttribute('aria-busy')).toBe('true');

    resolve({ ok: true });
  });

  it('shows the error + the manual command when the update fails', async () => {
    const onUpdateCli = vi
      .fn()
      .mockResolvedValue({ ok: false, error: 'npm not found on PATH' });
    const user = userEvent.setup();
    render(
      <ConnectionScreen
        snapshot={snapshotWith(
          SERVER_OLDER,
          '/Users/x/Library/Application Support/MoxxyAI Workspaces/cli/node_modules/@moxxy/cli/dist/bin.js',
        )}
        onRetry={vi.fn()}
        onUpdateCli={onUpdateCli}
      />,
    );

    await user.click(screen.getByRole('button', { name: /update cli & reconnect/i }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toMatch(/npm not found on PATH/i);
    // Manual escape hatch: the exact prefix-scoped install command.
    expect(
      screen.getAllByText(
        /npm install --prefix .*MoxxyAI Workspaces\/cli.* @moxxy\/cli@latest/i,
      ).length,
    ).toBeGreaterThan(0);
  });

  it('shows reinstall guidance and NO update button when the APP is older than the runner', () => {
    render(
      <ConnectionScreen
        snapshot={snapshotWith({
          phase: 'protocol-incompatible',
          serverVersion: 6, // runner is NEWER
          clientVersion: 5, // app is OLDER
          detail: 'runner protocol mismatch: server v6, client v5',
          hint: 'This app is out of date. Reinstall the latest moxxy desktop app to continue.',
        })}
        onRetry={vi.fn()}
        onUpdateCli={vi.fn()}
      />,
    );
    expect(
      screen.queryByRole('button', { name: /update cli & reconnect/i }),
    ).toBeNull();
    // The note tells the user to reinstall the app (the hint also says so).
    expect(screen.getAllByText(/reinstall the latest moxxy desktop app/i).length).toBeGreaterThan(0);
    // And it must NOT claim updating the CLI would help.
    expect(screen.getByText(/updating the cli/i)).toBeTruthy();
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

describe('manualUpdateCommand', () => {
  it('derives the <userData>/cli prefix from the resolved CLI path', () => {
    const cmd = manualUpdateCommand(
      '/Users/x/Library/Application Support/MoxxyAI Workspaces/cli/node_modules/@moxxy/cli/dist/bin.js',
    );
    expect(cmd).toBe(
      'npm install --prefix "/Users/x/Library/Application Support/MoxxyAI Workspaces/cli" @moxxy/cli@latest',
    );
  });

  it('falls back to a placeholder prefix when the path is unknown', () => {
    expect(manualUpdateCommand(null)).toBe(
      'npm install --prefix "<userData>/cli" @moxxy/cli@latest',
    );
  });

  it('handles Windows-style separators', () => {
    const cmd = manualUpdateCommand(
      'C:\\Users\\x\\AppData\\Roaming\\MoxxyAI Workspaces\\cli\\node_modules\\@moxxy\\cli\\dist\\bin.js',
    );
    expect(cmd).toBe(
      'npm install --prefix "C:\\Users\\x\\AppData\\Roaming\\MoxxyAI Workspaces\\cli" @moxxy/cli@latest',
    );
  });
});
