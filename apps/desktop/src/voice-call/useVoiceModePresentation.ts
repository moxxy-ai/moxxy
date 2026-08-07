import { useEffect, useMemo, useState } from 'react';
import type { MoxxyEvent } from '@moxxy/sdk';
import type { VoiceActiveOperation, VoiceCallPhase } from '@moxxy/client-core';
import {
  buildVoiceOrbit,
  createVoiceOrbitState,
  syncVoiceOrbit,
  type VoiceOrbitView,
} from './voice-orbit';

export interface VoiceModeStatus {
  readonly title: string;
  readonly detail: string;
}

const STATUS: Readonly<Record<VoiceCallPhase, VoiceModeStatus>> = Object.freeze({
  idle: { title: 'Voice mode', detail: 'Ready to start' },
  checking: { title: 'Preparing', detail: 'Checking microphone and Local Piper' },
  arming: { title: 'Preparing microphone', detail: 'The microphone will be ready in a moment' },
  listening: { title: 'Listening', detail: 'Speak naturally. I will answer when you finish.' },
  transcribing: { title: 'Transcribing', detail: 'Turning your voice into text' },
  thinking: { title: 'Thinking', detail: 'Using the context from this conversation' },
  working: { title: 'Working', detail: 'Operations remain visible until they finish' },
  'waiting-for-input': { title: 'Needs your input', detail: 'Answer the request to continue' },
  synthesizing: { title: 'Preparing voice', detail: 'Local Piper is generating the next sentence' },
  speaking: { title: 'Speaking', detail: 'Speak at any time to interrupt' },
  paused: { title: 'Microphone off', detail: 'Moxxy will not listen until you turn it back on' },
  error: { title: 'Voice mode stopped', detail: 'Resolve the issue and try again' },
});
const EMPTY_OUTCOMES: ReadonlyMap<string, boolean> = new Map();

function resultOutcomes(events: ReadonlyArray<MoxxyEvent>): ReadonlyMap<string, boolean> {
  const outcomes = new Map<string, boolean>();
  for (const event of events) {
    if (event.type === 'tool_result') outcomes.set(event.callId, event.ok);
  }
  return outcomes;
}

export function useVoiceModePresentation({
  active,
  phase,
  microphoneMuted,
  localPiperInstallRequired,
  localPiperInstalling,
  activeOperations,
  events,
}: {
  readonly active: boolean;
  readonly phase: VoiceCallPhase;
  readonly microphoneMuted: boolean;
  readonly localPiperInstallRequired: boolean;
  readonly localPiperInstalling: boolean;
  readonly activeOperations: ReadonlyArray<VoiceActiveOperation>;
  readonly events: ReadonlyArray<MoxxyEvent>;
}): { readonly status: VoiceModeStatus; readonly orbit: VoiceOrbitView } {
  const outcomes = useMemo(() => active ? resultOutcomes(events) : EMPTY_OUTCOMES, [active, events]);
  const [orbitState, setOrbitState] = useState(createVoiceOrbitState);

  useEffect(() => {
    if (!active) {
      setOrbitState(createVoiceOrbitState());
      return;
    }
    setOrbitState((previous) => syncVoiceOrbit(previous, activeOperations, outcomes, Date.now()));
  }, [active, activeOperations, outcomes]);

  const orbit = buildVoiceOrbit(orbitState, Date.now());
  useEffect(() => {
    if (!active || orbit.nextExpiry === null) return;
    const delay = Math.max(0, orbit.nextExpiry - Date.now());
    const timer = window.setTimeout(() => {
      setOrbitState((previous) => syncVoiceOrbit(previous, activeOperations, outcomes, Date.now()));
    }, delay);
    return () => window.clearTimeout(timer);
  }, [active, activeOperations, orbit.nextExpiry, outcomes]);

  const status = localPiperInstallRequired
    ? localPiperInstalling
      ? { title: 'Installing local voice', detail: 'Downloading the offline voice package' }
      : { title: 'Local voice required', detail: 'Install Local Piper once to use Voice Mode' }
    : phase === 'speaking' && microphoneMuted
      ? { title: STATUS.speaking.title, detail: 'The microphone will stay off after this answer' }
      : STATUS[phase];

  return { status, orbit };
}
