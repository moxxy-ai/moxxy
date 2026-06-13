import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ChatSurface } from './ChatSurface';

vi.mock('./Composer', () => ({
  Composer: () => (
    <div data-testid="composer-mock">
      <span>Model: fake</span>
      <span>Attach</span>
    </div>
  ),
}));

vi.mock('@moxxy/client-core', () => ({
  useChat: () => ({
    events: [],
    extensions: [],
    streamingText: '',
    sending: false,
    activeTurnId: null,
    error: null,
    isEmpty: true,
    loading: false,
    compacting: false,
    send: vi.fn(),
    abort: vi.fn(),
    clear: vi.fn(),
    hasOlder: false,
    loadOlder: vi.fn(),
  }),
  useDesks: () => ({
    desks: [],
    activeId: null,
    loading: false,
    error: null,
    refresh: vi.fn(),
    create: vi.fn(),
    remove: vi.fn(),
    setActive: vi.fn(),
    pickFolder: vi.fn(),
    rename: vi.fn(),
  }),
  useActiveAsk: () => null,
  deskForWorkspace: () => undefined,
}));

const loadingPhase = {
  phase: 'reconnecting',
  reason: 'loading selected session',
  attempt: 0,
} as const;

describe('ChatSurface session readiness', () => {
  it('hides the composer and agent controls while the selected session runner is loading', () => {
    render(
      <ChatSurface
        phase={loadingPhase}
        workspaceId="fresh-session"
        sessionLoading
        railOpen={false}
        onShowRail={vi.fn()}
        onView={vi.fn()}
      />,
    );

    expect(screen.getByText('Moxxy is loading this session…')).toBeInTheDocument();
    expect(screen.queryByTestId('composer-mock')).not.toBeInTheDocument();
    expect(screen.queryByText(/^Model:/)).not.toBeInTheDocument();
    expect(screen.queryByText('Attach')).not.toBeInTheDocument();
  });
});
