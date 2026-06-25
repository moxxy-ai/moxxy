/**
 * Stage 1: inactive — the 44×44 logo-only square. Clicking it expands
 * the widget to the active stage.
 */

import { LogoMark, ReplyPreviewButton } from './focus-primitives';
import { style } from './focus-styles';
import type { FocusTileGestureProps, FocusTileHorizontalAnchor } from './useFocusTileGesture';
import type { InactiveReplyPreview } from './useInactiveReplyPreview';

export function Inactive({
  preview,
  horizontalAnchor,
  dragging,
  gestureProps,
  onPreviewActivate,
}: {
  readonly preview: InactiveReplyPreview | null;
  readonly horizontalAnchor: FocusTileHorizontalAnchor;
  readonly dragging: boolean;
  readonly gestureProps: FocusTileGestureProps;
  readonly onPreviewActivate: () => void;
}): JSX.Element {
  const withPreview = !!preview;
  return (
    <div
      style={{
        ...style.inactiveRoot,
        ...(withPreview ? style.inactiveRootWithPreview : null),
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
      {preview ? (
        <ReplyPreviewButton text={preview.text} onClick={onPreviewActivate} />
      ) : null}
    </div>
  );
}
