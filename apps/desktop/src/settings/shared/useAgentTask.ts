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

import { useEffect, useState } from 'react';
import { api, chatStore, toErrorMessage } from '@moxxy/client-core';
import type { MoxxyEvent } from '@moxxy/sdk';

export type AgentTaskPhase = 'idle' | 'streaming' | 'done' | 'error';

export interface AgentTask {
  readonly phase: AgentTaskPhase;
  readonly output: string;
  readonly error: string | null;
  readonly start: (prompt: string) => Promise<void>;
}

export function useAgentTask(workspaceId: string | null): AgentTask {
  const [phase, setPhase] = useState<AgentTaskPhase>('idle');
  const [output, setOutput] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [turnId, setTurnId] = useState<string | null>(null);

  useEffect(() => {
    if (!turnId) return;
    const offEvent = api().subscribe(
      'runner.event',
      ({ event: ev }: { workspaceId: string; event: MoxxyEvent }) => {
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
      ({ turnId: id, error: err }: { workspaceId: string; turnId: string; error: string | null }) => {
        if (id !== turnId) return;
        chatStore.unhideTurn(id);
        if (err) {
          setPhase('error');
          setError(err);
        } else {
          setPhase('done');
        }
      },
    );
    return () => {
      offEvent();
      offDone();
      chatStore.unhideTurn(turnId);
    };
  }, [turnId]);

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
