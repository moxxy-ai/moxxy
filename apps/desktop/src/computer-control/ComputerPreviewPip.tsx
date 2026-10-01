import { useEffect, useRef } from 'react';
import type { ComputerCursor } from '@moxxy/sdk';
import { Icon } from '@moxxy/desktop-ui';
import { cursorPlace, previewLabel, type HideScope, type PreviewImage, type PreviewView } from './preview-model';
import './computer-control.css';

interface Props {
  view: PreviewView;
  /** The app (and window) in the picture, for its accessible name. */
  target: string | null;
  cursor: ComputerCursor | null;
  onHide(scope: HideScope): void;
  /** Receives the canvas while the view is a video stream; the decoder paints into it. */
  videoCanvas?: (canvas: HTMLCanvasElement | null) => void;
}

/** Paints the latest JPEG frame; a video stream is painted into the same kind of element by its decoder. */
function useFrame(image: PreviewImage | undefined) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (!image) return;
    const picture = new Image();
    picture.onload = () => canvas.current?.getContext('2d')?.drawImage(picture, 0, 0, image.width, image.height);
    picture.src = `data:${image.mediaType};base64,${image.base64}`;
    return () => { picture.onload = null; };
  }, [image]);
  return canvas;
}

export function ComputerPreviewPip({ view, target, cursor, onHide, videoCanvas }: Props): JSX.Element {
  const image = view.frame?.image;
  const canvas = useFrame(image);
  const size = image ?? view.video;
  return <figure className="computer-preview" data-state={view.state}>
    <div className="computer-preview__picture">
      {size && <canvas key={image ? 'frames' : 'video'} ref={image ? canvas : videoCanvas} role="img"
        aria-label={target ? `Live view of ${target}` : 'Live view of the app in use'} width={size.width} height={size.height} />}
      {size && cursor && <span data-testid="computer-preview-cursor" className="computer-preview__cursor" data-phase={cursor.phase} style={cursorPlace(cursor)}>
        {/* The same arrowhead the helper draws over the app (CursorOverlay.arrow). */}
        <svg viewBox="-2 -2 18 23" width="14" height="18" aria-hidden="true"><path d="M0 0 L0.6 19 L5.6 14.2 L13.8 13.6 Z" /></svg>
      </span>}
    </div>
    <figcaption>
      <span role="status" aria-live="polite">{previewLabel(view)}</span>
      <button type="button" aria-label="Hide the live view in this conversation" title="Hide in this conversation" onClick={() => onHide('conversation')}>
        <Icon name="x" size={12} aria-hidden="true" />
      </button>
      <button type="button" aria-label="Hide the live view in all conversations" title="Hide in all conversations" onClick={() => onHide('all')}>Hide always</button>
    </figcaption>
  </figure>;
}
