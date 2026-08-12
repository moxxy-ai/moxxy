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
import { FOCUS_PET_LAYOUT } from '@moxxy/desktop-ipc-contract';
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
  const petWidth = voiceModeActive
    ? FOCUS_PET_LAYOUT.voiceActiveCollapsedWidth
    : FOCUS_PET_LAYOUT.collapsedWidth;
  const pet = (
    <div style={{ ...style.focusPetDock, width: petWidth }}>
      <button
        type="button"
        {...gestureProps}
        aria-label={voiceModeActive
          ? 'Moxxy voice mode active, click to expand'
          : 'Moxxy, click to expand'}
        style={{
          ...style.inactiveButton,
          width: petWidth,
          cursor: dragging ? 'grabbing' : 'grab',
        }}
      >
        <FocusPetAvatar
          phase={voiceModePhase}
          microphoneMuted={voiceModeMuted}
          voiceModeActive={voiceModeActive}
          showRadioWaves={voiceModeActive}
          inputAnalyser={inputAnalyser}
          outputAnalyser={outputAnalyser}
        />
      </button>
    </div>
  );

  const chrome = bubbleRestoreVisible ? (
    <div
      style={{
        ...style.focusPetRestoreRoot,
        width: petWidth + 36,
        flexDirection: horizontalAnchor === 'right' ? 'row' : 'row-reverse',
      }}
    >
      <FocusBubbleRestoreButton onClick={onShowBubble} />
      {pet}
    </div>
  ) : pet;

  if (ask) {
    return (
      <div
        style={{
          ...style.inactiveRoot,
          ...style.inactiveRootWithPreview,
          flexDirection: horizontalAnchor === 'right' ? 'row-reverse' : 'row',
        }}
      >
        {chrome}
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
        {chrome}
      </div>
    );
  }

  return (
    <div style={style.inactiveRoot}>
      {chrome}
    </div>
  );
}
