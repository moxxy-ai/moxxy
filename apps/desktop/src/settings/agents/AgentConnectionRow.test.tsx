import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProviderEntry } from '@moxxy/desktop-ipc-contract';
import { AgentConnectionRow, SLOW_RUN_SECONDS } from './AgentConnectionRow';
import type { AgentConnectionRowModel } from './useAgentConnections';

const entry = { name: 'opencode', agentName: 'OpenCode', enabled: true, ready: false, active: false } as unknown as ProviderEntry;
const installing = (progress: number | null): AgentConnectionRowModel => ({
  entry,
  view: { state: 'installing', detail: 'This usually takes about a minute.', details: null, action: null, progress },
  jobAction: 'install',
  signedIn: false,
});

describe('AgentConnectionRow while its CLI installs', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('shows the time so far when the installer gives no percentage, and says a slow connection takes longer', () => {
    render(<AgentConnectionRow row={installing(null)} onAction={() => undefined} />);
    const row = screen.getByTestId('agent-row-opencode');
    expect(screen.getByRole('progressbar', { name: 'Installing OpenCode' })).not.toHaveAttribute('aria-valuenow');
    expect(row).toHaveTextContent('0:00');
    expect(row).not.toHaveTextContent('slow connection');
    act(() => vi.advanceTimersByTime(SLOW_RUN_SECONDS * 1000));
    expect(row).toHaveTextContent('0:45');
    expect(row).toHaveTextContent('A slow connection can take a few minutes.');
  });

  it('shows the percentage instead of the time once the installer says how far it got', () => {
    render(<AgentConnectionRow row={installing(0.4)} onAction={() => undefined} />);
    const row = screen.getByTestId('agent-row-opencode');
    expect(row).toHaveTextContent('40%');
    expect(row).not.toHaveTextContent('0:00');
  });
});
