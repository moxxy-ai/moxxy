import { useMemo } from 'react';
import type { MoxxyEvent } from '@moxxy/sdk';
import type { VoiceCallPhase, VoiceToolActivity } from '@moxxy/client-core';

export interface FocusTaskStatus {
  readonly key: string;
  readonly title: string;
  readonly text: string;
  readonly busy: true;
}

interface FocusTaskStatusInput {
  readonly events: ReadonlyArray<MoxxyEvent>;
  readonly activeTurnId: string | null;
  readonly sending: boolean;
  readonly voiceModeActive: boolean;
  readonly voiceModePhase: VoiceCallPhase;
  readonly activity: VoiceToolActivity | null;
}

const ACTIVITY_LABELS: Readonly<Record<VoiceToolActivity, string>> = Object.freeze({
  research: 'Checking information',
  editing: 'Writing changes',
  command: 'Running commands',
  verification: 'Checking the result',
  application: 'Working in the app',
  generic: 'Working on your request',
});

const PHASE_LABELS: Partial<Readonly<Record<VoiceCallPhase, string>>> = Object.freeze({
  arming: 'Preparing microphone',
  transcribing: 'Transcribing your message',
  thinking: 'Preparing a response',
  working: 'Working on your request',
  synthesizing: 'Preparing the voice response',
  speaking: 'Answering your request',
});

function compactTaskText(text: string): string {
  return text.trim().replace(/\s+/gu, ' ');
}

function promptForTurn(
  events: ReadonlyArray<MoxxyEvent>,
  activeTurnId: string | null,
): string | null {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (!event || event.type !== 'user_prompt') continue;
    if (activeTurnId !== null && event.turnId !== activeTurnId) continue;
    const text = compactTaskText(event.text);
    if (text) return text;
  }
  return null;
}

export function selectFocusTaskStatus({
  events,
  activeTurnId,
  sending,
  voiceModeActive,
  voiceModePhase,
  activity,
}: FocusTaskStatusInput): FocusTaskStatus | null {
  const phaseLabel = voiceModeActive ? PHASE_LABELS[voiceModePhase] : undefined;
  const turnActive = activeTurnId !== null || sending;
  if (!turnActive) {
    if (
      voiceModeActive
      && (voiceModePhase === 'arming' || voiceModePhase === 'transcribing')
      && phaseLabel
    ) {
      return {
        key: `voice:${voiceModePhase}`,
        title: 'Voice Mode',
        text: phaseLabel,
        busy: true,
      };
    }
    return null;
  }

  const prompt = promptForTurn(events, activeTurnId);
  return {
    key: activeTurnId ?? (voiceModeActive ? `voice:${voiceModePhase}` : 'turn:pending'),
    title: voiceModeActive ? 'Voice Mode' : 'Moxxy',
    text: prompt ?? (activity ? ACTIVITY_LABELS[activity] : phaseLabel) ?? 'Working on your request',
    busy: true,
  };
}

export function useFocusTaskStatus(input: FocusTaskStatusInput): FocusTaskStatus | null {
  return useMemo(
    () => selectFocusTaskStatus(input),
    [
      input.activeTurnId,
      input.activity,
      input.events,
      input.sending,
      input.voiceModeActive,
      input.voiceModePhase,
    ],
  );
}
