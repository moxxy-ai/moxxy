export type FocusHorizontalAnchor = 'left' | 'right';

export interface FocusBounds {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface FocusWorkArea {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface FocusPlacement {
  readonly bounds: FocusBounds;
  readonly horizontalAnchor: FocusHorizontalAnchor;
}

export interface FocusScreenPoint {
  readonly screenX: number;
  readonly screenY: number;
}

export interface FocusDragStart {
  readonly bounds: FocusBounds;
  readonly pointer: FocusScreenPoint;
}

const EDGE_MARGIN = 4;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(value, max));
}

function anchorFor(bounds: FocusBounds, workArea: FocusWorkArea): FocusHorizontalAnchor {
  const centerX = bounds.x + bounds.width / 2;
  const workCenterX = workArea.x + workArea.width / 2;
  return centerX >= workCenterX ? 'right' : 'left';
}

function clampBounds(bounds: FocusBounds, workArea: FocusWorkArea): FocusBounds {
  const maxX = workArea.x + workArea.width - bounds.width - EDGE_MARGIN;
  const maxY = workArea.y + workArea.height - bounds.height - EDGE_MARGIN;
  return {
    x: Math.round(clamp(bounds.x, workArea.x + EDGE_MARGIN, maxX)),
    y: Math.round(clamp(bounds.y, workArea.y + EDGE_MARGIN, maxY)),
    width: bounds.width,
    height: bounds.height,
  };
}

export function resizeFocusBounds({
  current,
  nextSize,
  restoreBounds,
  workArea,
}: {
  readonly current: FocusBounds;
  readonly nextSize: Pick<FocusBounds, 'width' | 'height'>;
  readonly restoreBounds?: FocusBounds | null;
  readonly workArea: FocusWorkArea;
}): FocusPlacement {
  const resizeSource = restoreBounds ?? current;
  const horizontalAnchor = anchorFor(resizeSource, workArea);
  const nextX =
    horizontalAnchor === 'right'
      ? resizeSource.x + resizeSource.width - nextSize.width
      : resizeSource.x;
  const nextY = resizeSource.y + (resizeSource.height - nextSize.height) / 2;
  const bounds = clampBounds(
    { x: nextX, y: nextY, width: nextSize.width, height: nextSize.height },
    workArea,
  );
  return { bounds, horizontalAnchor };
}

export function moveFocusBounds({
  current,
  delta,
  workArea,
}: {
  readonly current: FocusBounds;
  readonly delta: { readonly dx: number; readonly dy: number };
  readonly workArea: FocusWorkArea;
}): FocusPlacement {
  const bounds = clampBounds(
    {
      ...current,
      x: current.x + delta.dx,
      y: current.y + delta.dy,
    },
    workArea,
  );
  return { bounds, horizontalAnchor: anchorFor(bounds, workArea) };
}

export function moveFocusBoundsFromPointer({
  dragStart,
  pointer,
  workArea,
}: {
  readonly dragStart: FocusDragStart;
  readonly pointer: FocusScreenPoint;
  readonly workArea: FocusWorkArea;
}): FocusPlacement {
  const bounds = clampBounds(
    {
      ...dragStart.bounds,
      x: dragStart.bounds.x + (pointer.screenX - dragStart.pointer.screenX),
      y: dragStart.bounds.y + (pointer.screenY - dragStart.pointer.screenY),
    },
    workArea,
  );
  return { bounds, horizontalAnchor: anchorFor(bounds, workArea) };
}
