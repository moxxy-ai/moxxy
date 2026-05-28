import { describe, expect, it, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { App } from './App';
import { mockTauri } from '@/__mocks__/tauri';

vi.mock('@/lib/tauri', () => import('@/__mocks__/tauri'));

describe('<App />', () => {
  beforeEach(() => {
    mockTauri.reset();
  });

  it('renders the brand mark in the empty state', () => {
    mockTauri.respond('sidecar_status', () => 'starting');
    render(<App />);
    expect(screen.getByText('moxxy')).toBeInTheDocument();
  });

  it('shows runner status in the sidebar header', async () => {
    mockTauri.respond('sidecar_status', () => 'running');
    render(<App />);
    const label = await screen.findByTestId('runner-status');
    await waitFor(() => expect(label).toHaveTextContent('running'));
  });

  it('shows the "connect a provider" hint once running', async () => {
    mockTauri.respond('sidecar_status', () => 'running');
    render(<App />);
    expect(
      await screen.findByText(/Connect a provider to start your first turn/),
    ).toBeInTheDocument();
  });

  it('shows the offline hint when the runner has crashed', async () => {
    mockTauri.respond('sidecar_status', () => 'crashed');
    render(<App />);
    expect(
      await screen.findByText(/Runner offline/),
    ).toBeInTheDocument();
  });
});
