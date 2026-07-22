/**
 * FocusWidget — the floating mini surface.
 *
 * Stages:
 *
 *   inactive    44×44   logo tile. Click → ACTIVE.
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
 * The tile / action bar stay compact; transient preview copy is rendered as a
 * lightweight bubble beside them and never drives per-token window resizing.
 */

import { useEffect, useRef, useState } from 'react';
import {
  api,
  ChatStoreBridge,
  ConnectionBridge,
  useActiveWorkspaceId,
  useChat,
  useConnection,
  useVoiceRecorder,
  type VoiceCallPhase,
} from '@moxxy/client-core';
import { Inactive } from './Inactive';
import { Active } from './Active';
import { MiniText } from './MiniText';
import { useTheme } from '@/lib/useTheme';
import { useFocusTileGesture, type FocusTileHorizontalAnchor } from './useFocusTileGesture';
import { useInactiveReplyPreview } from './useInactiveReplyPreview';
import { useFocusAsk } from './useFocusAsk';
import {
  FOCUS_MINI_TEXT_DEFAULT_SIZE,
  useFocusMiniTextSize,
} from './useFocusMiniTextSize';
import { useDesktopVoiceCall } from '../voice-call/useDesktopVoiceCall';
import { deriveFocusAudioVisualization } from './focus-audio-visualization';

type Stage = 'inactive' | 'active' | 'mini-text';

// Keep the compact bar fitted to its current action set. Full Voice Mode adds
// mute and waiting-sound controls, while its error state swaps those for retry.
const ACTIVE_WIDTH_WITHOUT_MIC = 196;
const ACTIVE_ACTION_WIDTH = 36;
const INACTIVE_PREVIEW_SIZE = { width: 430, height: 104 };
const ACTIVE_PREVIEW_EXTRA_WIDTH = 378;
const PREVIEW_HEIGHT = 104;
const INACTIVE_ASK_SIZE = { width: 580, height: 216 };
const ACTIVE_ASK_EXTRA_WIDTH = 500;
const ASK_HEIGHT = 216;

const SIZE: Record<Stage, { width: number; height: number }> = {
  inactive: { width: 44, height: 44 },
  active: { width: ACTIVE_WIDTH_WITHOUT_MIC, height: 56 },
  // Taller default so a few lines of the latest message are readable
  // before the user even resizes; the panel scrolls + is drag-resizable.
  'mini-text': FOCUS_MINI_TEXT_DEFAULT_SIZE,
};

export function focusActiveWidth({
  hasTranscriber,
  voiceModeAvailable,
  voiceModeActive,
  voiceModePhase,
  voiceModeRetryAvailable,
}: {
  readonly hasTranscriber: boolean;
  readonly voiceModeAvailable: boolean;
  readonly voiceModeActive: boolean;
  readonly voiceModePhase: VoiceCallPhase;
  readonly voiceModeRetryAvailable: boolean;
}): number {
  if (!voiceModeActive) {
    const actionCount = Number(hasTranscriber) + Number(voiceModeAvailable);
    return ACTIVE_WIDTH_WITHOUT_MIC + ACTIVE_ACTION_WIDTH * actionCount;
  }
  const voiceActionCount = voiceModePhase === 'error'
    ? 1 + Number(voiceModeRetryAvailable)
    : 3;
  return ACTIVE_WIDTH_WITHOUT_MIC + ACTIVE_ACTION_WIDTH * voiceActionCount;
}

// ---- Top-level wrapper ---------------------------------------------------

export function FocusWidget(): JSX.Element {
  useTheme();
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
  const [localPiperInstalled, setLocalPiperInstalled] = useState<boolean | null>(null);
  const [analyser, setAnalyser] = useState<unknown | null>(null);
  const [horizontalAnchor, setHorizontalAnchor] = useState<FocusTileHorizontalAnchor>('right');
  const chat = useChat(workspaceId);
  const connection = useConnection(workspaceId);
  const { preview, dismissPreview } = useInactiveReplyPreview({ stage, workspaceId });
  const ask = useFocusAsk(workspaceId);
  const askVisible = ask !== null;
  const chromePreview = askVisible ? null : preview;
  const previewVisible = chromePreview !== null;
  const ready = workspaceId !== null
    && connection.snapshot?.phase.phase === 'connected'
    && !chat.loading;
  const voiceCall = useDesktopVoiceCall({
    surface: 'focus',
    workspaceId: workspaceId ?? '',
    ready,
    chat,
    inputRequired: askVisible,
  });
  const previousVoiceModeActive = useRef(false);
  const voiceModeAvailable = voiceCall.active || (
    localPiperInstalled === true && hasTranscriber === true && ready
  );
  const activeWidth = focusActiveWidth({
    hasTranscriber: hasTranscriber !== false,
    voiceModeAvailable,
    voiceModeActive: voiceCall.active,
    voiceModePhase: voiceCall.phase,
    voiceModeRetryAvailable: !voiceCall.localPiperInstallRequired,
  });
  const miniTextSize = useFocusMiniTextSize(stage === 'mini-text');
  const openPreview = (): void => {
    dismissPreview();
    setStage('mini-text');
  };
  const openInactive = (): void => {
    if (chromePreview) {
      openPreview();
      return;
    }
    setStage('active');
  };
  const tileGesture = useFocusTileGesture({
    onClick: openInactive,
    onPlacement: setHorizontalAnchor,
  });

  // Voice capture lives here, not in Active: when the user stops a
  // recording we switch to the mini-text stage (which unmounts Active),
  // and the in-flight transcription + send must keep running.
  const voice = useVoiceRecorder({
    ...(workspaceId ? { workspaceId } : {}),
    onTranscript: (text) => {
      if (workspaceId) void chat.send(text);
    },
    onAnalyser: setAnalyser,
  });
  const audioVisualization = deriveFocusAudioVisualization({
    voiceModeActive: voiceCall.active,
    voiceInputAnalyser: voiceCall.inputAnalyser,
    voiceOutputAnalyser: voiceCall.outputAnalyser,
    oneShotRecording: voice.phase === 'recording',
    oneShotAnalyser: analyser,
  });
  const openVoiceMode = (): void => {
    if (voice.phase !== 'idle') voice.cancel();
    voiceCall.open();
  };

  useEffect(() => {
    const becameActive = !previousVoiceModeActive.current && voiceCall.active;
    previousVoiceModeActive.current = voiceCall.active;
    if (becameActive) setStage('active');
  }, [voiceCall.active]);

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
    void api()
      .invoke('voice.isLocalPiperInstalled')
      .then((installed) => {
        if (!cancelled) setLocalPiperInstalled(Boolean(installed));
      })
      .catch(() => {
        if (!cancelled) setLocalPiperInstalled(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let { width, height } = SIZE[stage];
    if (stage === 'active') {
      width = activeWidth;
    } else if (stage === 'mini-text') {
      width = miniTextSize.width;
      height = miniTextSize.height;
    }
    if (stage === 'inactive' && askVisible) {
      width = INACTIVE_ASK_SIZE.width;
      height = INACTIVE_ASK_SIZE.height;
    } else if (stage === 'inactive' && previewVisible) {
      width = INACTIVE_PREVIEW_SIZE.width;
      height = INACTIVE_PREVIEW_SIZE.height;
    }
    if (stage === 'active' && askVisible) {
      width = Math.min(activeWidth + ACTIVE_ASK_EXTRA_WIDTH, 760);
      height = ASK_HEIGHT;
    } else if (stage === 'active' && previewVisible) {
      width = activeWidth + ACTIVE_PREVIEW_EXTRA_WIDTH;
      height = PREVIEW_HEIGHT;
    }
    void api()
      .invoke('focus.resize', { width, height, resizable: stage === 'mini-text' })
      .then((placement) => {
        if (placement?.horizontalAnchor) setHorizontalAnchor(placement.horizontalAnchor);
      })
      .catch(() => undefined);
  }, [stage, activeWidth, previewVisible, askVisible, miniTextSize.width, miniTextSize.height]);

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
        preview={chromePreview}
        ask={ask}
        horizontalAnchor={horizontalAnchor}
        dragging={tileGesture.dragging}
        gestureProps={tileGesture.gestureProps}
        voiceModeActive={voiceCall.active}
        voiceModePhase={voiceCall.phase}
        onPreviewActivate={openInactive}
      />
    );
  if (stage === 'active')
    return (
      <Active
        preview={chromePreview}
        ask={ask}
        horizontalAnchor={horizontalAnchor}
        width={activeWidth}
        hasTranscriber={hasTranscriber === true}
        recording={voice.phase === 'recording'}
        transcribing={voice.phase === 'transcribing'}
        audioVisualization={audioVisualization}
        voiceModeAvailable={voiceModeAvailable}
        voiceModeActive={voiceCall.active}
        voiceModePhase={voiceCall.phase}
        voiceModeErrorReason={voiceCall.errorReason}
        voiceModeMuted={voiceCall.microphoneMuted}
        waitingSoundEnabled={voiceCall.waitingSoundEnabled}
        localPiperInstallRequired={voiceCall.localPiperInstallRequired}
        onToggleMic={voice.toggle}
        onStartVoiceMode={openVoiceMode}
        onEndVoiceMode={voiceCall.close}
        onRetryVoiceMode={voiceCall.retry}
        onMuteVoiceMode={voiceCall.muteMicrophone}
        onUnmuteVoiceMode={voiceCall.unmuteMicrophone}
        onToggleWaitingSound={voiceCall.toggleWaitingSound}
        onCollapse={collapse}
        onText={() => setStage('mini-text')}
        onPreviewActivate={openPreview}
      />
    );
  return (
    <MiniText
      workspaceId={workspaceId}
      ask={ask}
      transcribing={
        voice.phase === 'transcribing' || voiceCall.phase === 'transcribing'
      }
      onBack={() => setStage('active')}
    />
  );
}
