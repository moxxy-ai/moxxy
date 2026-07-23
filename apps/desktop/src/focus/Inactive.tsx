/**
 * Stage 1: inactive — the animated Moxxy pet inside a transparent window.
 * Clicking it expands the widget to the active stage.
 */

import { style } from './focus-styles';
import { FocusAskCard } from './FocusAskCard';
import type { VoiceCallPhase } from '@moxxy/client-core';
import type { FocusTileGestureProps, FocusTileHorizontalAnchor } from './useFocusTileGesture';
import type { FocusAskPrompt } from './useFocusAsk';
import { FocusPetAvatar } from './FocusPetAvatar';
import {
  FocusBubbleRestoreButton,
  FocusPetBubble,
  type FocusPetBubbleContent,
} from './FocusPetBubble';

export function Inactive({
  bubble,
  ask,
  horizontalAnchor,
  dragging,
  gestureProps,
  voiceModeActive,
  voiceModePhase,
  voiceModeMuted,
  inputAnalyser,
  outputAnalyser,
  bubbleRestoreVisible,
  onBubbleActivate,
  onHideBubble,
  onShowBubble,
}: {
  readonly bubble: FocusPetBubbleContent | null;
  readonly ask: FocusAskPrompt | null;
  readonly horizontalAnchor: FocusTileHorizontalAnchor;
  readonly dragging: boolean;
  readonly gestureProps: FocusTileGestureProps;
  readonly voiceModeActive: boolean;
  readonly voiceModePhase: VoiceCallPhase;
  readonly voiceModeMuted: boolean;
  readonly inputAnalyser: unknown | null;
  readonly outputAnalyser: unknown | null;
  readonly bubbleRestoreVisible: boolean;
  readonly onBubbleActivate: () => void;
  readonly onHideBubble: () => void;
  readonly onShowBubble: () => void;
}): JSX.Element {
  const pet = (
    <div style={style.focusPetDock}>
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
      {bubbleRestoreVisible && <FocusBubbleRestoreButton onClick={onShowBubble} />}
    </div>
  );

  if (ask) {
    return (
      <div
        style={{
          ...style.inactiveRoot,
          ...style.inactiveRootWithPreview,
          flexDirection: horizontalAnchor === 'right' ? 'row-reverse' : 'row',
        }}
      >
        {pet}
        <FocusAskCard prompt={ask} variant="toast" />
      </div>
    );
  }

  if (bubble) {
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
        {pet}
      </div>
    );
  }

  return (
    <div style={style.inactiveRoot}>
      {pet}
    </div>
  );
}
