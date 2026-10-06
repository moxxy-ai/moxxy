import type { MoxxyEvent } from '@moxxy/sdk';

export interface VoiceAgentTurn {
  readonly sending: boolean;
  readonly activeTurnId: string | null;
  readonly streamingText: string;
  readonly events: ReadonlyArray<MoxxyEvent>;
}

export interface VoiceAgentWork {
  readonly label: string;
  /** Time since the agent's last visible step (`m:ss`), when known. */
  readonly elapsed: string | null;
}

/**
 * What the agent is doing between tool calls. A single model call can run for
 * minutes (writing a whole file into one tool call) with no tool active, and
 * "No tools running" then reads like a hang.
 */
export function voiceAgentWork(turn: VoiceAgentTurn, now: number): VoiceAgentWork | null {
  if (!turn.sending && turn.activeTurnId === null) return null;
  const label = turn.streamingText.trim() ? 'Agent writing a reply' : 'Agent thinking';
  const since = lastStepAt(turn.events, turn.activeTurnId);
  return { label, elapsed: since === null ? null : formatElapsed(now - since) };
}

function lastStepAt(events: ReadonlyArray<MoxxyEvent>, turnId: string | null): number | null {
  if (turnId === null) return null;
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (event?.turnId === turnId) return event.ts;
  }
  return null;
}

function formatElapsed(milliseconds: number): string {
  const seconds = Math.max(0, Math.floor(milliseconds / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}
