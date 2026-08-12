import { useEffect, useMemo, useState } from 'react';
import type { MoxxyEvent } from '@moxxy/sdk';
import type { VoiceActiveOperation, VoiceCallPhase } from '@moxxy/client-core';
import { createVoiceOrbitState, syncVoiceOrbit } from './voice-orbit';
import { buildVoiceRail, type VoiceRailView } from './voice-rail';
import { resolveVoiceModeStatus, type VoiceModeStatus } from './voice-mode-status.js';

export type { VoiceModeStatus } from './voice-mode-status.js';
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
}): { readonly status: VoiceModeStatus; readonly rail: VoiceRailView } {
  const outcomes = useMemo(() => active ? resultOutcomes(events) : EMPTY_OUTCOMES, [active, events]);
  const [orbitState, setOrbitState] = useState(createVoiceOrbitState);

  useEffect(() => {
    if (!active) {
      setOrbitState(createVoiceOrbitState());
      return;
    }
    setOrbitState((previous) => syncVoiceOrbit(previous, activeOperations, outcomes, Date.now()));
  }, [active, activeOperations, outcomes]);

  const rail = buildVoiceRail(orbitState, Date.now());
  useEffect(() => {
    if (!active || rail.nextExpiry === null) return;
    const delay = Math.max(0, rail.nextExpiry - Date.now());
    const timer = window.setTimeout(() => {
      setOrbitState((previous) => syncVoiceOrbit(previous, activeOperations, outcomes, Date.now()));
    }, delay);
    return () => window.clearTimeout(timer);
  }, [active, activeOperations, rail.nextExpiry, outcomes]);

  const status = resolveVoiceModeStatus({
    phase,
    microphoneMuted,
    localPiperInstallRequired,
    localPiperInstalling,
  });

  return { status, rail };
}
