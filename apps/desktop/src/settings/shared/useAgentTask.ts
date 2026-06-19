/**
 * "Ask moxxy to do it" — runs a one-off background agent task as a real
 * runner turn against the active workspace's session (the only path to the
 * model from this thin client), but HIDES the turn from the transcript via
 * `chatStore.hideTurn` so it never pollutes the chat. Assistant chunks are
 * mirrored into local state for an in-modal preview.
 *
 * Lifted from the GenerateSkillModal flow so the skill / MCP / provider
 * settings flows all share one mechanism.
 */

import { useEffect, useRef, useState } from 'react';
import { api, chatStore, toErrorMessage } from '@moxxy/client-core';

export type AgentTaskPhase = 'idle' | 'streaming' | 'done' | 'error';

export interface AgentTask {
  readonly phase: AgentTaskPhase;
  readonly output: string;
  readonly error: string | null;
  readonly start: (prompt: string) => Promise<void>;
}

// If no runner.turn.complete arrives within this window the runner has likely
// dropped (process kill, WS partition); flip to error so the user can retry
// instead of being stuck on a forever-"Generating…" button.
const COMPLETE_TIMEOUT_MS = 120_000;

export function useAgentTask(workspaceId: string | null): AgentTask {
  const [phase, setPhase] = useState<AgentTaskPhase>('idle');
  const [output, setOutput] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [turnId, setTurnId] = useState<string | null>(null);
  // Tracks whether the turn reached a terminal state, so unmount knows whether
  // it still needs to abort the in-flight turn server-side.
  const settledRef = useRef(false);

  useEffect(() => {
    if (!turnId) return;
    settledRef.current = false;
    const offEvent = api().subscribe(
      'runner.event',
      ({ event: ev }) => {
        if (ev.turnId !== turnId) return;
        if (ev.type === 'assistant_chunk') {
          setOutput((cur) => cur + ev.delta);
        } else if (ev.type === 'assistant_message') {
          setOutput(ev.content);
        }
      },
    );
    const offDone = api().subscribe(
      'runner.turn.complete',
      ({ turnId: id, error: err }) => {
        if (id !== turnId) return;
        settledRef.current = true;
        clearTimeout(watchdog);
        chatStore.unhideTurn(id);
        if (err) {
          setPhase('error');
          setError(err);
        } else {
          setPhase('done');
        }
      },
    );
    const watchdog = setTimeout(() => {
      if (settledRef.current) return;
      settledRef.current = true;
      chatStore.unhideTurn(turnId);
      // Best-effort: tell the runner to stop the orphaned turn so it stops
      // consuming model tokens after we've given up waiting.
      void api().invoke('session.abortTurn', { workspaceId: workspaceId ?? undefined, turnId });
      setPhase('error');
      setError('Timed out waiting for the runner to finish — it may have disconnected. Try again.');
    }, COMPLETE_TIMEOUT_MS);
    return () => {
      offEvent();
      offDone();
      clearTimeout(watchdog);
      chatStore.unhideTurn(turnId);
      // If the modal closes mid-stream, abort the hidden turn so it doesn't
      // keep consuming tokens server-side after the user walked away.
      if (!settledRef.current) {
        void api().invoke('session.abortTurn', { workspaceId: workspaceId ?? undefined, turnId });
      }
    };
  }, [turnId, workspaceId]);

  const start = async (prompt: string): Promise<void> => {
    if (!workspaceId || phase === 'streaming') return;
    setPhase('streaming');
    setOutput('');
    setError(null);
    try {
      const { turnId: id } = await api().invoke('session.runTurn', { workspaceId, prompt });
      // Hide BEFORE we start reading: the runner echoes a user_prompt + the
      // assistant output for this turn, and none of it should reach the
      // transcript. We deliberately do NOT dispatch send_started either, so
      // the chat never shows a phantom "sending" turn.
      chatStore.hideTurn(id);
      setTurnId(id);
    } catch (e) {
      setPhase('error');
      setError(toErrorMessage(e));
    }
  };

  return { phase, output, error, start };
}
