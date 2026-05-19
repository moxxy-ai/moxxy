import { useRef, useState } from 'react';
import type React from 'react';
import { runTurn, type Session } from '@moxxy/core';
import type { UserPromptAttachment } from '@moxxy/sdk';
import type { EventStreamHandle } from './use-event-stream.js';

export interface QueuedMessage {
  text: string;
  attachments: UserPromptAttachment[];
}

export interface TurnRunnerOptions {
  session: Session;
  /** Resolved model id at turn-start time (override > prop > default). */
  resolveModel: () => string | undefined;
  stream: EventStreamHandle;
}

export interface TurnRunnerHandle {
  busy: boolean;
  busyRef: React.MutableRefObject<boolean>;
  busyStartedAt: number | null;
  setBusy: React.Dispatch<React.SetStateAction<boolean>>;
  setBusyStartedAt: React.Dispatch<React.SetStateAction<number | null>>;
  queueRef: React.MutableRefObject<QueuedMessage[]>;
  queueCount: number;
  setQueueCount: React.Dispatch<React.SetStateAction<number>>;
  turnControllerRef: React.MutableRefObject<AbortController | null>;
  runTurnWith: (text: string, attachments: UserPromptAttachment[]) => Promise<void>;
}

export function useTurnRunner(opts: TurnRunnerOptions): TurnRunnerHandle {
  const [busy, setBusy] = useState(false);
  // Wall-clock start of the active turn (epoch ms). Powers the spinner +
  // elapsed-time readout in the status bar. `null` between turns.
  const [busyStartedAt, setBusyStartedAt] = useState<number | null>(null);
  const queueRef = useRef<QueuedMessage[]>([]);
  const [queueCount, setQueueCount] = useState(0);
  const busyRef = useRef(false);
  // Per-turn abort controller. Esc while busy aborts THIS turn without
  // poisoning the session's own controller, so the next prompt still
  // runs normally.
  const turnControllerRef = useRef<AbortController | null>(null);

  const runTurnWith = async (text: string, attachments: UserPromptAttachment[]): Promise<void> => {
    setBusy(true);
    busyRef.current = true;
    setBusyStartedAt(Date.now());
    opts.stream.cancelStreamFlush();
    opts.stream.streamingBufferRef.current = '';
    opts.stream.setStreamingDelta('');
    const effectiveModel = opts.resolveModel();
    // Fresh controller per turn so Esc cancels just this turn, not the
    // session.
    const controller = new AbortController();
    turnControllerRef.current = controller;
    try {
      for await (const _event of runTurn(opts.session, text, {
        ...(effectiveModel ? { model: effectiveModel } : {}),
        signal: controller.signal,
        ...(attachments.length > 0 ? { attachments } : {}),
      })) {
        void _event;
      }
    } catch (err) {
      // surfaced via error events; nothing extra to do
      void err;
    } finally {
      turnControllerRef.current = null;
      setBusy(false);
      busyRef.current = false;
      setBusyStartedAt(null);
      // Drain any messages the user queued while this turn was running.
      // Concatenate into one follow-up turn so the model sees the
      // user's accumulated input as one coherent prompt rather than N
      // micro-turns. Idempotent when the queue is empty.
      if (queueRef.current.length > 0) {
        const batch = queueRef.current.splice(0);
        setQueueCount(0);
        const joinedText = batch.map((b) => b.text).join('\n\n');
        const joinedAtts = batch.flatMap((b) => b.attachments);
        await runTurnWith(joinedText, joinedAtts);
      }
    }
  };

  return {
    busy,
    busyRef,
    busyStartedAt,
    setBusy,
    setBusyStartedAt,
    queueRef,
    queueCount,
    setQueueCount,
    turnControllerRef,
    runTurnWith,
  };
}
