import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ChatSurface } from './ChatSurface';

const chatState = vi.hoisted(() => ({
  loading: false,
  events: [] as Array<{ type: string; text?: string; content?: string }>,
}));

vi.mock('./Composer', () => ({
  Composer: ({ ready }: { readonly ready: boolean }) => (
    <div data-testid="composer-mock" data-ready={String(ready)}>
      <span>Model: fake</span>
      <span>Attach</span>
    </div>
  ),
}));

vi.mock('./Transcript', () => ({
  Transcript: ({
    events,
  }: {
    readonly events: ReadonlyArray<{ readonly text?: string; readonly content?: string }>;
  }) => (
    <div data-testid="transcript-mock">
      {events.map((event) => event.text ?? event.content ?? '').join('\n')}
    </div>
  ),
}));

vi.mock('@moxxy/client-core', () => ({
  api: () => ({
    invoke: vi.fn(async () => undefined),
    subscribe: () => () => undefined,
  }),
  useChat: () => ({
    events: chatState.events,
    extensions: [],
    streamingText: '',
    sending: false,
    activeTurnId: null,
    error: null,
    isEmpty: chatState.events.length === 0,
    loading: chatState.loading,
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
  beforeEach(() => {
    chatState.loading = false;
    chatState.events = [];
  });

  it('uses the full loading state while the selected session runner is loading before transcript is available', () => {
    render(
      <ChatSurface
        phase={loadingPhase}
        workspaceId="fresh-session"
        sessionLoading
        railPane={null}
        onPickPane={vi.fn()}
        onView={vi.fn()}
      />,
    );

    expect(screen.getByText('Moxxy is loading this session…')).toBeInTheDocument();
    expect(screen.queryByTestId('composer-mock')).not.toBeInTheDocument();
    expect(screen.queryByText(/^Model:/)).not.toBeInTheDocument();
    expect(screen.queryByText('Attach')).not.toBeInTheDocument();
  });

  it('uses the full loading state while the selected session history is loading before transcript is available', () => {
    chatState.loading = true;

    render(
      <ChatSurface
        phase={{
          phase: 'connected',
          socket: '/tmp/fresh-session.sock',
          sessionId: 'fresh-session',
          activeProvider: 'openai-codex',
          activeMode: 'default',
        }}
        workspaceId="fresh-session"
        sessionLoading={false}
        railPane={null}
        onPickPane={vi.fn()}
        onView={vi.fn()}
      />,
    );

    expect(screen.getByText('Loading conversation…')).toBeInTheDocument();
    expect(screen.queryByTestId('composer-mock')).not.toBeInTheDocument();
    expect(screen.queryByText(/^Model:/)).not.toBeInTheDocument();
    expect(screen.queryByText('Attach')).not.toBeInTheDocument();
  });

  it('keeps an already loaded transcript mounted while the selected session runner reconnects', () => {
    chatState.events = [
      { type: 'user_prompt', text: 'cached prompt from a huge session' },
      { type: 'assistant_message', content: 'cached answer from a huge session' },
    ];

    render(
      <ChatSurface
        phase={loadingPhase}
        workspaceId="huge-session"
        sessionLoading
        railPane={null}
        onPickPane={vi.fn()}
        onView={vi.fn()}
      />,
    );

    expect(screen.queryByText('Moxxy is loading this session…')).not.toBeInTheDocument();
    expect(screen.getByTestId('transcript-mock')).toHaveTextContent(
      'cached answer from a huge session',
    );
    expect(screen.getByTestId('composer-mock')).toHaveAttribute('data-ready', 'false');
  });
});
