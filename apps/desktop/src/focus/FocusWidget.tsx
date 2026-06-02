/**
 * FocusWidget — the floating mini surface.
 *
 * Stages:
 *
 *   inactive    44×44   logo only. Click → ACTIVE.
 *
 *   active     232×56   logo + voice + text + restore-main + close.
 *                       Mic button starts an in-place recording overlay
 *                       (spectrum visualiser fills the panel background).
 *                       Stopping the recording pops open the mini-text
 *                       panel so the transcript + answer are visible.
 *
 *   mini-text  380×440  scrollable, markdown transcript of the latest turn
 *                       + a composer. The user can drag the window edges to
 *                       resize it (the only stage that's edge-resizable).
 *
 * Resize is driven from here via the `focus.resize` IPC (size + whether
 * edge-resize is allowed); the main process applies it (focus-window.ts).
 *
 * Voice capture lives in this orchestrator (not in Active) so a recording
 * that's still transcribing survives the active → mini-text stage switch.
 *
 * Every stage is flat, sharp-cornered, shadowless.
 */

import { useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';
import { ChatStoreBridge, useChat } from '@/lib/useChat';
import { useVoiceRecorder } from '@/lib/useVoiceRecorder';
import { ConnectionBridge, useActiveWorkspaceId } from '@/lib/useConnection';
import { Inactive } from './Inactive';
import { Active } from './Active';
import { MiniText } from './MiniText';

type Stage = 'inactive' | 'active' | 'mini-text';

// Active width depends on whether the mic button is present. With
// the mic visible there are 4 actions (mic, text, restore, close);
// without it just 3, so we tighten the panel accordingly so it
// doesn't look hollow on the right.
const ACTIVE_WIDTH_WITH_MIC = 232;
const ACTIVE_WIDTH_WITHOUT_MIC = 196;

const SIZE: Record<Stage, { width: number; height: number }> = {
  inactive: { width: 44, height: 44 },
  active: { width: ACTIVE_WIDTH_WITH_MIC, height: 56 },
  // Taller default so a few lines of the latest message are readable
  // before the user even resizes; the panel scrolls + is drag-resizable.
  'mini-text': { width: 380, height: 440 },
};

// ---- Top-level wrapper ---------------------------------------------------

export function FocusWidget(): JSX.Element {
  const workspaceId = useActiveWorkspaceId();
  return (
    <>
      <ConnectionBridge />
      <ChatStoreBridge />
      <Surface workspaceId={workspaceId} />
    </>
  );
}

function Surface({
  workspaceId,
}: {
  readonly workspaceId: string | null;
}): JSX.Element {
  const [stage, setStage] = useState<Stage>('inactive');
  // Lifted from Active so the resize IPC knows whether to tighten
  // the panel before painting (no flicker on first activation).
  const [hasTranscriber, setHasTranscriber] = useState<boolean | null>(null);
  const [analyser, setAnalyser] = useState<AnalyserNode | null>(null);
  const chat = useChat(workspaceId);

  // Voice capture lives here, not in Active: when the user stops a
  // recording we switch to the mini-text stage (which unmounts Active),
  // and the in-flight transcription + send must keep running.
  const voice = useVoiceRecorder({
    onTranscript: (text) => {
      if (workspaceId) void chat.send(text);
    },
    onAnalyser: setAnalyser,
  });

  // Stopping a recording (recording → transcribing) opens the mini-text
  // panel so the user watches the transcript + streaming answer there.
  const prevVoicePhase = useRef(voice.phase);
  useEffect(() => {
    if (prevVoicePhase.current === 'recording' && voice.phase === 'transcribing') {
      setStage('mini-text');
    }
    prevVoicePhase.current = voice.phase;
  }, [voice.phase]);

  useEffect(() => {
    let cancelled = false;
    void api()
      .invoke('session.hasTranscriber')
      .then((has) => {
        if (!cancelled) setHasTranscriber(Boolean(has));
      })
      .catch(() => {
        if (!cancelled) setHasTranscriber(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const { height } = SIZE[stage];
    let width = SIZE[stage].width;
    if (stage === 'active' && hasTranscriber === false) {
      width = ACTIVE_WIDTH_WITHOUT_MIC;
    }
    void api()
      .invoke('focus.resize', { width, height, resizable: stage === 'mini-text' })
      .catch(() => undefined);
  }, [stage, hasTranscriber]);

  if (stage === 'inactive')
    return <Inactive onActivate={() => setStage('active')} />;
  if (stage === 'active')
    return (
      <Active
        hasTranscriber={hasTranscriber === true}
        recording={voice.phase === 'recording'}
        transcribing={voice.phase === 'transcribing'}
        analyser={analyser}
        onToggleMic={voice.toggle}
        onCollapse={() => setStage('inactive')}
        onText={() => setStage('mini-text')}
      />
    );
  return (
    <MiniText
      workspaceId={workspaceId}
      transcribing={voice.phase === 'transcribing'}
      onBack={() => setStage('active')}
    />
  );
}
