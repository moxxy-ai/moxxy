/**
 * Stage 1: inactive — a 44×44 logo-only square inside a tiny transparent
 * window gutter. Clicking it expands the widget to the active stage.
 */

import { LogoMark, ReplyPreviewButton } from './focus-primitives';
import { style } from './focus-styles';
import { FocusAskCard } from './FocusAskCard';
import type { FocusTileGestureProps, FocusTileHorizontalAnchor } from './useFocusTileGesture';
import type { InactiveReplyPreview } from './useInactiveReplyPreview';
import type { FocusAskPrompt } from './useFocusAsk';

export function Inactive({
  preview,
  ask,
  horizontalAnchor,
  dragging,
  gestureProps,
  onPreviewActivate,
}: {
  readonly preview: InactiveReplyPreview | null;
  readonly ask: FocusAskPrompt | null;
  readonly horizontalAnchor: FocusTileHorizontalAnchor;
  readonly dragging: boolean;
  readonly gestureProps: FocusTileGestureProps;
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
        aria-label="moxxy · click to expand"
        style={{
          ...style.inactiveButton,
          cursor: dragging ? 'grabbing' : 'grab',
        }}
      >
        <LogoMark />
      </button>
      {ask ? (
        <FocusAskCard prompt={ask} variant="toast" />
      ) : preview ? (
        <ReplyPreviewButton text={preview.text} onClick={onPreviewActivate} />
      ) : null}
    </div>
  );
}
