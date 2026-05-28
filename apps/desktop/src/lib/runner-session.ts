import { useEffect, useReducer, useRef } from 'react';
import { invoke, subscribe } from './tauri';

/**
 * One transcript "block" the chat surface renders. The runner streams
 * many MoxxyEvent variants; for Phase 1 we coalesce them into three
 * UI-shaped blocks (user / assistant chunks / tool activity). Later
 * phases extend the renderer with the full variant set.
 */
export type Block =
  | { readonly id: string; readonly kind: 'user'; readonly text: string }
  | {
      readonly id: string;
      readonly kind: 'assistant';
      readonly text: string;
      readonly streaming: boolean;
    }
  | {
      readonly id: string;
      readonly kind: 'tool';
      readonly name: string;
      readonly status: 'running' | 'done' | 'error';
      readonly summary?: string;
    }
  | {
      readonly id: string;
      readonly kind: 'system';
      readonly text: string;
    }
  | {
      readonly id: string;
      readonly kind: 'error';
      readonly text: string;
    };

export interface RunnerSession {
  readonly ready: boolean;
  readonly blocks: ReadonlyArray<Block>;
  readonly activeTurnId: string | null;
  readonly error: string | null;
  /** Send a prompt. Resolves once the runner accepts the turn. */
  readonly send: (prompt: string) => Promise<void>;
  /** Abort the active turn, if any. */
  readonly abort: () => Promise<void>;
}

/**
 * Subset of runner event shapes the Phase 1 reducer needs. The runner
 * streams much richer events; unknown kinds are ignored without error so
 * the desktop stays forward-compatible as new event types ship.
 */
interface RunnerEvent {
  kind?: string;
  text?: string;
  message?: string;
  toolCall?: {
    name?: string;
    status?: 'running' | 'done' | 'error';
    summary?: string;
  };
}

type Action =
  | { type: 'ready'; value: boolean }
  | { type: 'sent'; turnId: string; prompt: string }
  | { type: 'event'; event: RunnerEvent }
  | { type: 'complete'; turnId: string; error?: string | null }
  | { type: 'error'; message: string };

interface State {
  ready: boolean;
  blocks: Block[];
  activeTurnId: string | null;
  error: string | null;
  /** Id of the streaming assistant block, if one is open. */
  streamingAssistantId: string | null;
  nextId: number;
}

const initialState: State = {
  ready: false,
  blocks: [],
  activeTurnId: null,
  error: null,
  streamingAssistantId: null,
  nextId: 1,
};

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'ready':
      return { ...state, ready: action.value };
    case 'sent': {
      const userBlockId = `b${state.nextId}`;
      return {
        ...state,
        activeTurnId: action.turnId,
        error: null,
        blocks: [
          ...state.blocks,
          { id: userBlockId, kind: 'user', text: action.prompt },
        ],
        streamingAssistantId: null,
        nextId: state.nextId + 1,
      };
    }
    case 'event': {
      const { event } = action;
      // Assistant text chunk: append to the open streaming block, or
      // open a fresh one if none is in flight.
      if (event.kind === 'chunk' && typeof event.text === 'string') {
        if (state.streamingAssistantId) {
          return {
            ...state,
            blocks: state.blocks.map((b) =>
              b.id === state.streamingAssistantId && b.kind === 'assistant'
                ? { ...b, text: b.text + (event.text ?? '') }
                : b,
            ),
          };
        }
        const id = `b${state.nextId}`;
        return {
          ...state,
          blocks: [
            ...state.blocks,
            { id, kind: 'assistant', text: event.text, streaming: true },
          ],
          streamingAssistantId: id,
          nextId: state.nextId + 1,
        };
      }
      // Tool activity strip. If a tool with this name is already
      // 'running', updating it advances the status — otherwise we
      // append. Keeps the transcript from accumulating duplicate rows
      // for the running → done lifecycle.
      if (event.kind === 'tool' && event.toolCall?.name) {
        const name = event.toolCall.name;
        const status = event.toolCall.status ?? 'running';
        const summary = event.toolCall.summary;
        const existingIdx = [...state.blocks].reverse().findIndex(
          (b) => b.kind === 'tool' && b.name === name && b.status === 'running',
        );
        if (existingIdx >= 0 && status !== 'running') {
          const absoluteIdx = state.blocks.length - 1 - existingIdx;
          const updated = state.blocks.slice();
          const existing = updated[absoluteIdx]!;
          if (existing.kind === 'tool') {
            updated[absoluteIdx] = {
              ...existing,
              status,
              summary: summary ?? existing.summary,
            };
          }
          return { ...state, blocks: updated };
        }
        const id = `b${state.nextId}`;
        return {
          ...state,
          blocks: [
            ...state.blocks,
            { id, kind: 'tool', name, status, summary },
          ],
          nextId: state.nextId + 1,
        };
      }
      // System message (e.g. mode switch, provider change announcement).
      if (event.kind === 'system' && typeof event.text === 'string') {
        const id = `b${state.nextId}`;
        return {
          ...state,
          blocks: [
            ...state.blocks,
            { id, kind: 'system', text: event.text },
          ],
          nextId: state.nextId + 1,
        };
      }
      // Error event (e.g. provider failure inside the turn).
      if (event.kind === 'error' && typeof event.message === 'string') {
        const id = `b${state.nextId}`;
        return {
          ...state,
          blocks: [
            ...state.blocks,
            { id, kind: 'error', text: event.message },
          ],
          nextId: state.nextId + 1,
        };
      }
      return state;
    }
    case 'complete': {
      // Close any open streaming block; record any error.
      return {
        ...state,
        activeTurnId: null,
        streamingAssistantId: null,
        error: action.error ?? null,
        blocks: state.blocks.map((b) =>
          b.id === state.streamingAssistantId && b.kind === 'assistant'
            ? { ...b, streaming: false }
            : b,
        ),
      };
    }
    case 'error':
      return { ...state, error: action.message };
    default:
      return state;
  }
}

/**
 * Hook that turns the Tauri command surface + event stream into a single
 * declarative state for the chat UI. Subscribes on mount, drains its
 * listeners on unmount.
 */
export function useRunnerSession(): RunnerSession {
  const [state, dispatch] = useReducer(reducer, initialState);
  // Keep refs to dispatch + state so the imperative `send` / `abort`
  // callbacks below don't change identity on every render.
  const dispatchRef = useRef(dispatch);
  dispatchRef.current = dispatch;
  const activeTurnRef = useRef<string | null>(null);
  activeTurnRef.current = state.activeTurnId;

  useEffect(() => {
    let cancelled = false;

    void invoke<boolean>('runner_ready')
      .then((ready) => {
        if (!cancelled) dispatchRef.current({ type: 'ready', value: ready });
      })
      .catch(() => {
        /* defensive — leave default */
      });

    const unsubs: Array<Promise<() => void>> = [
      subscribe<boolean>('runner.ready', (v) =>
        dispatchRef.current({ type: 'ready', value: v }),
      ),
      subscribe<RunnerEvent>('runner.event', (event) =>
        dispatchRef.current({ type: 'event', event }),
      ),
      subscribe<{ turnId: string; error?: string | null }>(
        'runner.turn.complete',
        (payload) =>
          dispatchRef.current({
            type: 'complete',
            turnId: payload.turnId,
            error: payload.error ?? null,
          }),
      ),
      subscribe<string>('runner.error', (message) =>
        dispatchRef.current({ type: 'error', message }),
      ),
    ];

    return () => {
      cancelled = true;
      for (const u of unsubs) {
        void u.then((fn) => fn());
      }
    };
  }, []);

  return {
    ready: state.ready,
    blocks: state.blocks,
    activeTurnId: state.activeTurnId,
    error: state.error,
    send: async (prompt: string) => {
      const text = prompt.trim();
      if (!text) return;
      const turnId = await invoke<string>('run_turn', { args: { prompt: text } });
      dispatchRef.current({ type: 'sent', turnId, prompt: text });
    },
    abort: async () => {
      const turnId = activeTurnRef.current;
      if (!turnId) return;
      await invoke('abort_turn', { turnId });
    },
  };
}
