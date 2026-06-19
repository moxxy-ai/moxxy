import { useRef, useState } from 'react';
import type React from 'react';
import type { ClientSession as Session, UserPromptAttachment } from '@moxxy/sdk';
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
  /** Optional notice sink — used to warn the user when a large queue drain is
   *  split across turns rather than merged into one oversized prompt. */
  onNotice?: (msg: string) => void;
}

/** Cap how many queued messages merge into one follow-up turn, and the joined
 *  character length, so a flood of queued (or large) messages can't be
 *  concatenated into a single prompt that blows past the model context window
 *  in one shot. The remainder stays queued and drains on the next turn. */
const MAX_DRAIN_MESSAGES = 50;
const MAX_DRAIN_CHARS = 200_000;

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
  /** Single-slot "next-up" message. When set, drain logic runs it ALONE
   *  before merging the rest of the queue. Surfaced as state so the UI
   *  can render it distinctly. */
  priorityMessage: QueuedMessage | null;
  /** Pop the head of the queue and mark it as the priority next-turn.
   *  No-op when the queue is empty. Returns whether anything moved. */
  forceSendFirst: () => boolean;
  /** Remove the head of the queue without running it. */
  dropFirst: () => boolean;
  /** Clear (or set) the single priority slot. Used by session resets
   *  (/new, /clear) to drop a force-sent message that must NOT survive the
   *  wipe. Keeps the mirrored ref + state in sync. */
  setPriority: (value: QueuedMessage | null) => void;
}

export function useTurnRunner(opts: TurnRunnerOptions): TurnRunnerHandle {
  const [busy, setBusy] = useState(false);
  // Wall-clock start of the active turn (epoch ms). Powers the spinner +
  // elapsed-time readout in the status bar. `null` between turns.
  const [busyStartedAt, setBusyStartedAt] = useState<number | null>(null);
  const queueRef = useRef<QueuedMessage[]>([]);
  const [queueCount, setQueueCount] = useState(0);
  // Single "send this next, alone" slot. Held in state (not just a ref)
  // so the QueueView re-renders when the user force-sends. Mirrored into a
  // ref so the (unmemoized) runTurnWith drain block reads the LATEST value
  // rather than the value captured by the closure that started the in-flight
  // turn — otherwise a mid-turn force-send is stranded (it was already
  // shifted out of queueRef, so the stale `priorityMessage===null` branch
  // never runs it). Mirrors the busy/busyRef pattern.
  const [priorityMessage, setPriorityMessage] = useState<QueuedMessage | null>(null);
  const priorityRef = useRef<QueuedMessage | null>(null);
  const setPriority = (value: QueuedMessage | null): void => {
    priorityRef.current = value;
    setPriorityMessage(value);
  };
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
      for await (const _event of opts.session.runTurn(text, {
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
      // Drain order:
      //   1. Priority slot (force-sent) runs ALONE so the user can land
      //      a single targeted follow-up without it merging with whatever
      //      else they typed.
      //   2. Remaining queue concatenates into one follow-up turn — the
      //      model sees accumulated input as one coherent prompt rather
      //      than N micro-turns.
      // else-if rather than an early `return` inside finally (a return in
      // finally is unsafe — it would swallow the try/catch outcome). The else
      // gives the same "priority runs alone, otherwise drain the queue".
      if (priorityRef.current) {
        const p = priorityRef.current;
        setPriority(null);
        await runTurnWith(p.text, p.attachments);
      } else if (queueRef.current.length > 0) {
        // Take a bounded batch: at most MAX_DRAIN_MESSAGES messages and
        // MAX_DRAIN_CHARS of joined text, leaving the rest queued for the next
        // drain (which auto-runs because the queue stays non-empty). Always
        // take at least one message so the queue can't stall.
        const batch: QueuedMessage[] = [];
        let chars = 0;
        while (queueRef.current.length > 0 && batch.length < MAX_DRAIN_MESSAGES) {
          const next = queueRef.current[0]!;
          const projected = chars + next.text.length;
          if (batch.length > 0 && projected > MAX_DRAIN_CHARS) break;
          batch.push(queueRef.current.shift()!);
          chars = projected;
        }
        const remaining = queueRef.current.length;
        setQueueCount(remaining);
        if (remaining > 0) {
          opts.onNotice?.(
            `queued input is large — sending ${batch.length} message${batch.length === 1 ? '' : 's'} now, ${remaining} will follow`,
          );
        }
        const joinedText = batch.map((b) => b.text).join('\n\n');
        const joinedAtts = batch.flatMap((b) => b.attachments);
        await runTurnWith(joinedText, joinedAtts);
      }
    }
  };

  const forceSendFirst = (): boolean => {
    if (queueRef.current.length === 0) return false;
    const first = queueRef.current.shift()!;
    setQueueCount(queueRef.current.length);
    setPriority(first);
    return true;
  };

  const dropFirst = (): boolean => {
    if (queueRef.current.length === 0) return false;
    queueRef.current.shift();
    setQueueCount(queueRef.current.length);
    return true;
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
    priorityMessage,
    forceSendFirst,
    dropFirst,
    setPriority,
  };
}
