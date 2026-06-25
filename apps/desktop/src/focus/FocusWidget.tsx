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
 * The tile stays compact; transient preview copy is rendered as a lightweight
 * bubble beside it and never drives per-token window resizing.
 */

import { useEffect, useRef, useState } from 'react';
import { api } from '@moxxy/client-core';
import { ChatStoreBridge, useChat } from '@moxxy/client-core';
import { useVoiceRecorder } from '@moxxy/client-core';
import { ConnectionBridge, useActiveWorkspaceId } from '@moxxy/client-core';
import { Inactive } from './Inactive';
import { Active } from './Active';
import { MiniText } from './MiniText';
import { useFocusTileGesture, type FocusTileHorizontalAnchor } from './useFocusTileGesture';
import { useInactiveReplyPreview } from './useInactiveReplyPreview';

type Stage = 'inactive' | 'active' | 'mini-text';

// Active width depends on whether the mic button is present. With
// the mic visible there are 4 actions (mic, text, restore, close);
// without it just 3, so we tighten the panel accordingly so it
// doesn't look hollow on the right.
const ACTIVE_WIDTH_WITH_MIC = 232;
const ACTIVE_WIDTH_WITHOUT_MIC = 196;
const INACTIVE_PREVIEW_SIZE = { width: 348, height: 76 };

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
  const [horizontalAnchor, setHorizontalAnchor] = useState<FocusTileHorizontalAnchor>('right');
  const chat = useChat(workspaceId);
  const { preview, dismissPreview } = useInactiveReplyPreview({ stage, workspaceId });
  const previewVisible = preview !== null;
  const openInactive = (): void => {
    dismissPreview();
    setStage(preview ? 'mini-text' : 'active');
  };
  const tileGesture = useFocusTileGesture({
    onClick: openInactive,
    onPlacement: setHorizontalAnchor,
  });

  // Voice capture lives here, not in Active: when the user stops a
  // recording we switch to the mini-text stage (which unmounts Active),
  // and the in-flight transcription + send must keep running.
  const voice = useVoiceRecorder({
    onTranscript: (text) => {
      if (workspaceId) void chat.send(text);
    },
    // The shared hook surfaces the analyser as an opaque value (it's DOM-free);
    // on the web it's the real AnalyserNode the spectrum visualiser expects.
    onAnalyser: (a) => setAnalyser((a as AnalyserNode | null) ?? null),
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
    let { width, height } = SIZE[stage];
    if (stage === 'inactive' && previewVisible) {
      width = INACTIVE_PREVIEW_SIZE.width;
      height = INACTIVE_PREVIEW_SIZE.height;
    }
    if (stage === 'active' && hasTranscriber === false) {
      width = ACTIVE_WIDTH_WITHOUT_MIC;
    }
    void api()
      .invoke('focus.resize', { width, height, resizable: stage === 'mini-text' })
      .then((placement) => {
        if (placement?.horizontalAnchor) setHorizontalAnchor(placement.horizontalAnchor);
      })
      .catch(() => undefined);
  }, [stage, hasTranscriber, previewVisible]);

  // Collapsing back to the inactive square hides the recording UI but the voice
  // recorder lives on the always-mounted Surface — so without explicitly
  // stopping it, the mic would keep capturing with NO visible indicator (a
  // privacy leak). Stop any in-flight recording before collapsing.
  const collapse = (): void => {
    if (voice.phase === 'recording') voice.stop();
    setStage('inactive');
  };

  if (stage === 'inactive')
    return (
      <Inactive
        preview={preview}
        horizontalAnchor={horizontalAnchor}
        dragging={tileGesture.dragging}
        gestureProps={tileGesture.gestureProps}
      />
    );
  if (stage === 'active')
    return (
      <Active
        hasTranscriber={hasTranscriber === true}
        recording={voice.phase === 'recording'}
        transcribing={voice.phase === 'transcribing'}
        analyser={analyser}
        onToggleMic={voice.toggle}
        onCollapse={collapse}
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
