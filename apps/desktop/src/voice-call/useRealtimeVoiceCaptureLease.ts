import { useEffect } from 'react';
import { api } from '@moxxy/client-core';
import type { DesktopVoiceCallSurface } from './desktop-voice-call-bridge';

function setRealtimeCaptureActive(active: boolean): void {
  void api().invoke('voice.setRealtimeCaptureActive', { active }).catch(() => undefined);
}

/** Keeps the hidden main renderer realtime while it remains the sole mic owner. */
export function useRealtimeVoiceCaptureLease(
  active: boolean,
  surface: DesktopVoiceCallSurface,
): void {
  useEffect(() => {
    if (surface !== 'main') return;
    setRealtimeCaptureActive(active);
  }, [active, surface]);

  useEffect(() => {
    if (surface !== 'main') return;
    return () => setRealtimeCaptureActive(false);
  }, [surface]);
}
