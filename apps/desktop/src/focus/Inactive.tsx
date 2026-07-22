/**
 * Stage 1: inactive — a 44×44 logo-only square inside a tiny transparent
 * window gutter. Clicking it expands the widget to the active stage.
 */

import { LogoMark, ReplyPreviewButton } from './focus-primitives';
import { style } from './focus-styles';
import { FocusAskCard } from './FocusAskCard';
import { FocusVoiceLiveIndicator } from './FocusVoiceLiveIndicator';
import type { VoiceCallPhase } from '@moxxy/client-core';
import type { FocusTileGestureProps, FocusTileHorizontalAnchor } from './useFocusTileGesture';
import type { InactiveReplyPreview } from './useInactiveReplyPreview';
import type { FocusAskPrompt } from './useFocusAsk';

export function Inactive({
  preview,
  ask,
  horizontalAnchor,
  dragging,
  gestureProps,
  voiceModeActive,
  voiceModePhase,
  onPreviewActivate,
}: {
  readonly preview: InactiveReplyPreview | null;
  readonly ask: FocusAskPrompt | null;
  readonly horizontalAnchor: FocusTileHorizontalAnchor;
  readonly dragging: boolean;
  readonly gestureProps: FocusTileGestureProps;
  readonly voiceModeActive: boolean;
  readonly voiceModePhase: VoiceCallPhase;
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
        <LogoMark />
        {voiceModeActive && <FocusVoiceLiveIndicator phase={voiceModePhase} />}
      </button>
      {ask ? (
        <FocusAskCard prompt={ask} variant="toast" />
      ) : preview ? (
        <ReplyPreviewButton text={preview.text} onClick={onPreviewActivate} />
      ) : null}
    </div>
  );
}
