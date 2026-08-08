import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { ChatSurface } from './ChatSurface';

const chatState = vi.hoisted(() => ({
  loading: false,
  events: [] as Array<{ type: string; text?: string; content?: string }>,
}));

const voiceCallState = vi.hoisted(() => ({
  active: false,
  phase: 'idle' as const,
  activity: null,
  activeOperations: [],
  errorReason: null as string | null,
  lastTranscript: null as string | null,
  inputAnalyser: null,
  outputAnalyser: null,
  open: vi.fn(),
  close: vi.fn(),
  retry: vi.fn(),
  pause: vi.fn(),
  resume: vi.fn(),
  finishUtterance: vi.fn(),
  restartListening: vi.fn(),
  bargeIn: vi.fn(),
}));

const focusModeToggle = vi.hoisted(() => vi.fn());

vi.mock('./chat-surface/useFocusModeToggle', () => ({
  useFocusModeToggle: () => focusModeToggle,
}));

vi.mock('./Composer', () => ({
  Composer: ({
    ready,
    onOpenVoiceCall,
  }: {
    readonly ready: boolean;
    readonly onOpenVoiceCall: () => void;
  }) => (
    <div data-testid="composer-mock" data-ready={String(ready)}>
      <span>Model: fake</span>
      <span>Attach</span>
      <button type="button" onClick={onOpenVoiceCall}>Voice mode</button>
    </div>
  ),
}));

vi.mock('../voice-call/VoiceCallSurface', () => ({
  VoiceCallSurface: ({
    onClose,
    onEnterFocusMode,
    conversation,
  }: {
    readonly onClose: () => void;
    readonly onEnterFocusMode: () => void;
    readonly conversation: React.ReactNode;
  }) => (
    <div data-testid="voice-call-surface-mock">
      <button type="button" onClick={onClose}>Back to chat</button>
      <button type="button" onClick={onEnterFocusMode}>Focus mode</button>
      {conversation}
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
  useActionCatalog: () => ({ loaded: true, skills: [], tools: [] }),
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
  useVoiceCall: () => voiceCallState,
  deskForWorkspace: () => undefined,
  // ChatSurface owns the session-info fetch now (one fetch shared by the
  // instrument bar's telemetry and the composer's mode menu), so its hook's
  // dependencies have to exist on the mock too.
  useConnection: () => ({ snapshot: undefined, hasEverConnected: false, retry: vi.fn() }),
  chatStore: {
    subscribe: () => () => undefined,
    getModel: () => null,
    getAutoApprove: () => false,
    setActive: vi.fn(),
  },
  useContextUsage: () => ({
    contextTokens: null,
    contextWindow: null,
    fraction: null,
    summary: { calls: 0, totalPrompt: 0, totalOutput: 0 },
    perCall: [],
    hasData: false,
  }),
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
    voiceCallState.active = false;
    voiceCallState.activeOperations = [];
    voiceCallState.open.mockClear();
    voiceCallState.close.mockClear();
    focusModeToggle.mockClear();
  });

  it('uses the full loading state while the selected session runner is loading before transcript is available', () => {
    render(
      <ChatSurface
        phase={loadingPhase}
        workspaceId="fresh-session"
        sessionLoading
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
      />,
    );

    expect(screen.queryByText('Moxxy is loading this session…')).not.toBeInTheDocument();
    expect(screen.getByTestId('transcript-mock')).toHaveTextContent(
      'cached answer from a huge session',
    );
    expect(screen.getByTestId('composer-mock')).toHaveAttribute('data-ready', 'false');
  });

  it('opens voice mode from the composer and replaces chat chrome until the call closes', () => {
    chatState.events = [
      { type: 'user_prompt', text: 'Keep the complete formatted conversation' },
      { type: 'assistant_message', content: 'Voice mode uses the shared transcript' },
    ];
    const props = {
      phase: {
        phase: 'connected',
        socket: '/tmp/voice-session.sock',
        sessionId: 'voice-session',
        activeProvider: 'openai-codex',
        activeMode: 'default',
      } as const,
      workspaceId: 'voice-session',
      sessionLoading: false,
      railPane: null,
      onPickPane: vi.fn(),
      onView: vi.fn(),
    };
    const view = render(<ChatSurface {...props} />);

    fireEvent.click(screen.getByRole('button', { name: 'Voice mode' }));
    expect(voiceCallState.open).toHaveBeenCalledOnce();

    voiceCallState.active = true;
    view.rerender(<ChatSurface {...props} />);

    expect(screen.getByTestId('voice-call-surface-mock')).toBeInTheDocument();
    expect(screen.getByTestId('transcript-mock')).toHaveTextContent('Voice mode uses the shared transcript');
    expect(screen.queryByTestId('composer-mock')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Focus mode' }));
    expect(focusModeToggle).toHaveBeenCalledOnce();
    expect(voiceCallState.close).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Back to chat' }));
    expect(voiceCallState.close).toHaveBeenCalledOnce();
  });
});
