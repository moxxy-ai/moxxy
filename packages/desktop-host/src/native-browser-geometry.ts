import type { NativeBrowserRect, NativeBrowserViewport } from '@moxxy/desktop-ipc-contract';

interface BoundsProjectionInput {
  readonly rect: NativeBrowserRect;
  readonly rendererViewport: NativeBrowserViewport;
  readonly contentBounds: NativeBrowserViewport;
}

export function projectNativeBrowserBounds({
  rect,
  rendererViewport,
  contentBounds,
}: BoundsProjectionInput): NativeBrowserRect {
  const values = [
    rect.x,
    rect.y,
    rect.width,
    rect.height,
    rendererViewport.width,
    rendererViewport.height,
    contentBounds.width,
    contentBounds.height,
  ];
  if (values.some((value) => !Number.isFinite(value)) || rect.width <= 0 || rect.height <= 0) {
    throw new Error('invalid native browser geometry');
  }
  if (
    rendererViewport.width <= 0 ||
    rendererViewport.height <= 0 ||
    contentBounds.width <= 0 ||
    contentBounds.height <= 0
  ) {
    throw new Error('invalid native browser viewport geometry');
  }

  const scaleX = contentBounds.width / rendererViewport.width;
  const scaleY = contentBounds.height / rendererViewport.height;
  const left = Math.max(0, Math.round(rect.x * scaleX));
  const top = Math.max(0, Math.round(rect.y * scaleY));
  const right = Math.min(contentBounds.width, Math.round((rect.x + rect.width) * scaleX));
  const bottom = Math.min(contentBounds.height, Math.round((rect.y + rect.height) * scaleY));
  const width = right - left;
  const height = bottom - top;
  if (width <= 0 || height <= 0) throw new Error('native browser geometry is outside the content area');
  return { x: left, y: top, width, height };
}
