/**
 * Stage 2: active — a compact 56px pill whose width follows the available
 * one-shot and full Voice Mode controls.
 *
 * Presentational: voice capture is owned by the FocusWidget orchestrator
 * (so an in-flight transcription survives the switch to mini-text that
 * happens on stop). This component just reflects the recording state and
 * paints the selected microphone or Piper visualisation behind the controls.
 */

import { api } from '@moxxy/client-core';
import type { VoiceCallPhase } from '@moxxy/client-core';
import { Icon } from '@moxxy/desktop-ui';
import {
  ActionButton,
  Dot,
  VoiceMicrophoneActionIcon,
} from './focus-primitives';
import { MicIcon, PencilIcon, WindowIcon, XIcon } from './focus-icons';
import { SpectroBackground } from './SpectroBackground';
import { style } from './focus-styles';
import { FocusAskCard } from './FocusAskCard';
import type { FocusTileHorizontalAnchor } from './useFocusTileGesture';
import type { FocusAskPrompt } from './useFocusAsk';
import type { FocusAudioVisualization } from './focus-audio-visualization';
import { FocusPetAvatar } from './FocusPetAvatar';
import {
  FocusBubbleRestoreButton,
  FocusPetBubble,
  type FocusPetBubbleContent,
} from './FocusPetBubble';

export function Active({
  bubble,
  ask,
  horizontalAnchor,
  width,
  hasTranscriber,
  recording,
  transcribing,
  audioVisualization,
  voiceModeAvailable,
  voiceModeActive,
  voiceModePhase,
  voiceModeErrorReason,
  voiceModeMuted,
  waitingSoundEnabled,
  localPiperInstallRequired,
  petPhase,
  petInputAnalyser,
  petOutputAnalyser,
  onToggleMic,
  onStartVoiceMode,
  onEndVoiceMode,
  onRetryVoiceMode,
  onMuteVoiceMode,
  onUnmuteVoiceMode,
  onToggleWaitingSound,
  onCollapse,
  onText,
  bubbleRestoreVisible,
  onBubbleActivate,
  onHideBubble,
  onShowBubble,
}: {
  readonly bubble: FocusPetBubbleContent | null;
  readonly ask: FocusAskPrompt | null;
  readonly horizontalAnchor: FocusTileHorizontalAnchor;
  readonly width: number;
  readonly hasTranscriber: boolean;
  readonly recording: boolean;
  readonly transcribing: boolean;
  readonly audioVisualization: FocusAudioVisualization | null;
  readonly voiceModeAvailable: boolean;
  readonly voiceModeActive: boolean;
  readonly voiceModePhase: VoiceCallPhase;
  readonly voiceModeErrorReason: string | null;
  readonly voiceModeMuted: boolean;
  readonly waitingSoundEnabled: boolean;
  readonly localPiperInstallRequired: boolean;
  readonly petPhase: VoiceCallPhase;
  readonly petInputAnalyser: unknown | null;
  readonly petOutputAnalyser: unknown | null;
  readonly onToggleMic: () => void;
  readonly onStartVoiceMode: () => void;
  readonly onEndVoiceMode: () => void;
  readonly onRetryVoiceMode: () => void;
  readonly onMuteVoiceMode: () => void;
  readonly onUnmuteVoiceMode: () => void;
  readonly onToggleWaitingSound: () => void;
  readonly onCollapse: () => void;
  readonly onText: () => void;
  readonly bubbleRestoreVisible: boolean;
  readonly onBubbleActivate: () => void;
  readonly onHideBubble: () => void;
  readonly onShowBubble: () => void;
}): JSX.Element {
  const bar = (
    <div
      style={{
        ...style.activeRoot,
        ...style.activeRootWithPreview,
        width,
      }}
    >
      {audioVisualization && (
        <SpectroBackground
          analyser={audioVisualization.analyser}
          source={audioVisualization.source}
        />
      )}
      <div style={style.activeDivider} aria-hidden />
      <div data-testid="focus-active-actions" style={style.activeActions}>
        {hasTranscriber && !voiceModeActive && (
          <ActionButton
            onClick={onToggleMic}
            aria-label={recording ? 'Stop recording' : 'Record voice'}
          >
            {transcribing ? <Dot delay={0} /> : <MicIcon />}
          </ActionButton>
        )}
        {voiceModeAvailable && !voiceModeActive && (
          <ActionButton onClick={onStartVoiceMode} aria-label="Start voice mode">
            <Icon name="spark" size={17} />
          </ActionButton>
        )}
        {voiceModeActive && (
          <ActionButton
            onClick={onEndVoiceMode}
            aria-label="End voice mode"
            active
            pressed
            title="Voice mode is active"
          >
            <Icon name="stop" size={16} />
          </ActionButton>
        )}
        {voiceModeActive && voiceModePhase === 'error' && !localPiperInstallRequired && (
          <ActionButton
            onClick={onRetryVoiceMode}
            aria-label="Retry voice mode"
            variant="danger"
            title={voiceModeErrorReason ?? 'Voice mode could not continue'}
          >
            <Icon name="rotate" size={17} />
          </ActionButton>
        )}
        {voiceModeActive && voiceModePhase !== 'error' && (
          <>
            <ActionButton
              onClick={voiceModeMuted ? onUnmuteVoiceMode : onMuteVoiceMode}
              aria-label={voiceModeMuted ? 'Unmute microphone' : 'Mute microphone'}
              active={!voiceModeMuted}
              pressed={!voiceModeMuted}
            >
              <VoiceMicrophoneActionIcon muted={voiceModeMuted} />
            </ActionButton>
            <ActionButton
              onClick={onToggleWaitingSound}
              aria-label={waitingSoundEnabled
                ? 'Turn waiting sound off'
                : 'Turn waiting sound on'}
              active={waitingSoundEnabled}
              pressed={waitingSoundEnabled}
            >
              <Icon name="speaker" size={17} />
            </ActionButton>
          </>
        )}
        {voiceModeActive && voiceModePhase === 'error' && !localPiperInstallRequired && (
          <span role="alert" style={style.visuallyHidden}>
            {voiceModeErrorReason ?? 'Voice mode could not continue'}
          </span>
        )}
        <ActionButton onClick={onText} aria-label="Text">
          <PencilIcon />
        </ActionButton>
        {/* Reopen the full app before the final close action. */}
        <ActionButton
          onClick={() => void api().invoke('focus.restoreMain').catch(() => undefined)}
          aria-label="Open main window"
        >
          <WindowIcon />
        </ActionButton>
        {/* Last icon dismisses Focus Mode without opening the main window. */}
        <ActionButton
          onClick={() => void api().invoke('focus.close').catch(() => undefined)}
          aria-label="Close focus mode"
          variant="danger"
        >
          <XIcon />
        </ActionButton>
      </div>
    </div>
  );

  const chromeRow = (
    <div style={style.activeChrome}>
      <div style={style.focusActiveDock}>
        <button
          type="button"
          onClick={onCollapse}
          aria-label="Collapse"
          style={style.activePetButton}
        >
          <FocusPetAvatar
            phase={petPhase}
            microphoneMuted={voiceModeMuted}
            voiceModeActive={voiceModeActive}
            inputAnalyser={petInputAnalyser}
            outputAnalyser={petOutputAnalyser}
          />
        </button>
      </div>
      {bar}
    </div>
  );

  const chrome = bubbleRestoreVisible ? (
    <div style={style.activeChromeWithRestore}>
      <div data-testid="focus-active-restore-dock" style={style.focusActiveRestoreDock}>
        <FocusBubbleRestoreButton onClick={onShowBubble} />
      </div>
      {chromeRow}
    </div>
  ) : chromeRow;

  if (!bubble && !ask) return chrome;

  if (bubble && !ask) {
    return (
      <div
        style={{
          ...style.focusPetBubbleRoot,
          alignItems: horizontalAnchor === 'right' ? 'flex-end' : 'flex-start',
        }}
      >
        <FocusPetBubble
          content={bubble}
          onActivate={onBubbleActivate}
          onHide={onHideBubble}
        />
        {chrome}
      </div>
    );
  }

  return (
    <div
      style={{
        ...style.activeRootWithPreviewBubble,
        flexDirection: horizontalAnchor === 'right' ? 'row-reverse' : 'row',
      }}
    >
      {chrome}
      {ask && <FocusAskCard prompt={ask} variant="toast" />}
    </div>
  );
}
