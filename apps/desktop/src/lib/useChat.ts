import { useCallback, useEffect, useReducer } from 'react';
import { api } from './api';
import type { MoxxyEvent } from '@moxxy/sdk';

/**
 * One render-shaped block in the transcript. The reducer below
 * coalesces the runner's fine-grained event stream into these so the
 * view layer can iterate without nested switches.
 */
export type Block =
  | { kind: 'user'; id: string; text: string }
  | {
      kind: 'assistant';
      id: string;
      text: string;
      streaming: boolean;
      stopReason?: string;
    }
  | {
      kind: 'tool';
      id: string;
      callId: string;
      name: string;
      input: unknown;
      status: 'running' | 'ok' | 'error';
      output?: unknown;
      error?: string;
    }
  | { kind: 'system'; id: string; text: string; tone: 'info' | 'error' };

export interface ChatState {
  blocks: Block[];
  activeTurnId: string | null;
  sending: boolean;
  error: string | null;
  /** Auto-incrementing counter so block ids don't collide on rapid
   *  events with the same turn id. */
  seq: number;
}

const initial: ChatState = {
  blocks: [],
  activeTurnId: null,
  sending: false,
  error: null,
  seq: 0,
};

export type ChatAction =
  | { type: 'event'; event: MoxxyEvent }
  | { type: 'send_started'; turnId: string; prompt: string }
  | { type: 'send_failed'; message: string }
  | { type: 'turn_complete'; turnId: string; error: string | null }
  | { type: 'clear' };
type Action = ChatAction;

function reducer(state: ChatState, action: Action): ChatState {
  switch (action.type) {
    case 'clear':
      return { ...initial };
    case 'send_started': {
      const block: Block = {
        kind: 'user',
        id: `u-${state.seq}`,
        text: action.prompt,
      };
      return {
        ...state,
        sending: true,
        error: null,
        activeTurnId: action.turnId,
        blocks: [...state.blocks, block],
        seq: state.seq + 1,
      };
    }
    case 'send_failed':
      return { ...state, sending: false, error: action.message };
    case 'turn_complete': {
      const next = closeStreamingAssistant(state.blocks);
      return {
        ...state,
        sending: false,
        activeTurnId: null,
        blocks: action.error
          ? [
              ...next,
              {
                kind: 'system',
                id: `s-${state.seq}`,
                text: action.error,
                tone: 'error',
              },
            ]
          : next,
        seq: state.seq + 1,
      };
    }
    case 'event':
      return apply(state, action.event);
    default:
      return state;
  }
}

function closeStreamingAssistant(blocks: Block[]): Block[] {
  return blocks.map((b) =>
    b.kind === 'assistant' && b.streaming ? { ...b, streaming: false } : b,
  );
}

function apply(state: ChatState, event: MoxxyEvent): ChatState {
  switch (event.type) {
    case 'user_prompt':
      // The renderer already added the user block on send_started so the
      // user sees instant feedback. Avoid duplicating if the runner
      // echoes the user prompt back.
      return state;
    case 'assistant_chunk': {
      const last = state.blocks[state.blocks.length - 1];
      if (last && last.kind === 'assistant' && last.streaming) {
        const updated: Block = {
          ...last,
          text: last.text + event.delta,
        };
        return { ...state, blocks: [...state.blocks.slice(0, -1), updated] };
      }
      const block: Block = {
        kind: 'assistant',
        id: `a-${state.seq}`,
        text: event.delta,
        streaming: true,
      };
      return {
        ...state,
        blocks: [...state.blocks, block],
        seq: state.seq + 1,
      };
    }
    case 'assistant_message': {
      const last = state.blocks[state.blocks.length - 1];
      if (last && last.kind === 'assistant' && last.streaming) {
        const updated: Block = {
          ...last,
          text: event.content,
          streaming: false,
          stopReason: event.stopReason,
        };
        return { ...state, blocks: [...state.blocks.slice(0, -1), updated] };
      }
      const block: Block = {
        kind: 'assistant',
        id: `a-${state.seq}`,
        text: event.content,
        streaming: false,
        stopReason: event.stopReason,
      };
      return {
        ...state,
        blocks: [...state.blocks, block],
        seq: state.seq + 1,
      };
    }
    case 'tool_call_requested': {
      const block: Block = {
        kind: 'tool',
        id: `t-${state.seq}`,
        callId: event.callId,
        name: event.name,
        input: event.input,
        status: 'running',
      };
      return {
        ...state,
        blocks: [...state.blocks, block],
        seq: state.seq + 1,
      };
    }
    case 'tool_result': {
      const next = state.blocks.map((b) =>
        b.kind === 'tool' && b.callId === event.callId
          ? {
              ...b,
              status: event.ok ? ('ok' as const) : ('error' as const),
              ...(event.output !== undefined ? { output: event.output } : {}),
              ...(event.error?.message ? { error: event.error.message } : {}),
            }
          : b,
      );
      return { ...state, blocks: next };
    }
    case 'tool_call_denied': {
      const next = state.blocks.map((b) =>
        b.kind === 'tool' && b.callId === event.callId
          ? { ...b, status: 'error' as const, error: event.reason }
          : b,
      );
      return { ...state, blocks: next };
    }
    case 'skill_invoked': {
      const block: Block = {
        kind: 'system',
        id: `s-${state.seq}`,
        text: `skill ${event.name} (${event.reason.replace(/_/g, ' ')})`,
        tone: 'info',
      };
      return {
        ...state,
        blocks: [...state.blocks, block],
        seq: state.seq + 1,
      };
    }
    case 'error': {
      const block: Block = {
        kind: 'system',
        id: `s-${state.seq}`,
        text: event.message,
        tone: 'error',
      };
      return {
        ...state,
        blocks: [...state.blocks, block],
        seq: state.seq + 1,
      };
    }
    case 'abort': {
      const next = closeStreamingAssistant(state.blocks);
      return {
        ...state,
        blocks: [
          ...next,
          {
            kind: 'system',
            id: `s-${state.seq}`,
            text: `aborted: ${event.reason}`,
            tone: 'info',
          },
        ],
        seq: state.seq + 1,
      };
    }
    default:
      // We intentionally don't render every variant (mode_iteration,
      // provider_request/response, plugin_*, compaction, elision).
      // They're available via the SessionInfo / debug panel later;
      // keeping the transcript clean is the priority.
      return state;
  }
}

export interface UseChat {
  readonly blocks: ReadonlyArray<Block>;
  readonly activeTurnId: string | null;
  readonly sending: boolean;
  readonly error: string | null;
  readonly send: (prompt: string) => Promise<void>;
  readonly abort: () => Promise<void>;
  readonly clear: () => void;
}

// Test-only export of the pure reducer + initial state. Keeps the
// dependency on React out of the reducer tests.
// eslint-disable-next-line @typescript-eslint/naming-convention
export const __reducerForTest = {
  initial: () => initial,
  apply: reducer,
};

export function useChat(): UseChat {
  const [state, dispatch] = useReducer(reducer, initial);

  useEffect(() => {
    const offEvent = api().subscribe('runner.event', (event: MoxxyEvent) => {
      dispatch({ type: 'event', event });
    });
    const offComplete = api().subscribe(
      'runner.turn.complete',
      ({ turnId, error }: { turnId: string; error: string | null }) => {
        dispatch({ type: 'turn_complete', turnId, error });
      },
    );
    return () => {
      offEvent();
      offComplete();
    };
  }, []);

  const send = useCallback(async (prompt: string): Promise<void> => {
    const trimmed = prompt.trim();
    if (!trimmed) return;
    try {
      const { turnId } = await api().invoke('session.runTurn', {
        prompt: trimmed,
      });
      dispatch({ type: 'send_started', turnId, prompt: trimmed });
    } catch (e) {
      dispatch({
        type: 'send_failed',
        message: e instanceof Error ? e.message : String(e),
      });
    }
  }, []);

  const abort = useCallback(async (): Promise<void> => {
    if (!state.activeTurnId) return;
    try {
      await api().invoke('session.abortTurn', { turnId: state.activeTurnId });
    } catch {
      /* best-effort */
    }
  }, [state.activeTurnId]);

  const clear = useCallback((): void => {
    dispatch({ type: 'clear' });
  }, []);

  return {
    blocks: state.blocks,
    activeTurnId: state.activeTurnId,
    sending: state.sending,
    error: state.error,
    send,
    abort,
    clear,
  };
}
