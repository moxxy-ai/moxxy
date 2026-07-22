/**
 * Stage 1: inactive — the animated Moxxy pet inside a transparent window.
 * Clicking it expands the widget to the active stage.
 */

import { ReplyPreviewButton } from './focus-primitives';
import { style } from './focus-styles';
import { FocusAskCard } from './FocusAskCard';
import type { VoiceCallPhase } from '@moxxy/client-core';
import type { FocusTileGestureProps, FocusTileHorizontalAnchor } from './useFocusTileGesture';
import type { InactiveReplyPreview } from './useInactiveReplyPreview';
import type { FocusAskPrompt } from './useFocusAsk';
import { FocusPetAvatar } from './FocusPetAvatar';

export function Inactive({
  preview,
  ask,
  horizontalAnchor,
  dragging,
  gestureProps,
  voiceModeActive,
  voiceModePhase,
  voiceModeMuted,
  inputAnalyser,
  outputAnalyser,
  onPreviewActivate,
}: {
  readonly preview: InactiveReplyPreview | null;
  readonly ask: FocusAskPrompt | null;
  readonly horizontalAnchor: FocusTileHorizontalAnchor;
  readonly dragging: boolean;
  readonly gestureProps: FocusTileGestureProps;
  readonly voiceModeActive: boolean;
  readonly voiceModePhase: VoiceCallPhase;
  readonly voiceModeMuted: boolean;
  readonly inputAnalyser: unknown | null;
  readonly outputAnalyser: unknown | null;
  readonly onPreviewActivate: () => void;
}): JSX.Element {
  const withSidecar = !!ask || !!preview;
  return (
    <div
      style={{
        ...style.inactiveRoot,
        ...(withSidecar ? style.inactiveRootWithPreview : null),
        flexDirection: horizontalAnchor === 'right' ? 'row-reverse' : 'row',
      }}
    >
      <button
        type="button"
        {...gestureProps}
        aria-label={voiceModeActive
          ? 'Moxxy voice mode active, click to expand'
          : 'Moxxy, click to expand'}
        style={{
          ...style.inactiveButton,
          cursor: dragging ? 'grabbing' : 'grab',
        }}
      >
        <FocusPetAvatar
          phase={voiceModePhase}
          microphoneMuted={voiceModeMuted}
          voiceModeActive={voiceModeActive}
          inputAnalyser={inputAnalyser}
          outputAnalyser={outputAnalyser}
        />
      </button>
      {ask ? (
        <FocusAskCard prompt={ask} variant="toast" />
      ) : preview ? (
        <ReplyPreviewButton text={preview.text} onClick={onPreviewActivate} />
      ) : null}
    </div>
  );
}
