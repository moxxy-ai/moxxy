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
}

/** Paints the latest frame; a canvas so a video decoder can paint into the same element later. */
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

export function ComputerPreviewPip({ view, target, cursor, onHide }: Props): JSX.Element {
  const image = view.frame?.image;
  const canvas = useFrame(image);
  return <figure className="computer-preview" data-state={view.state}>
    <div className="computer-preview__picture">
      {image && <canvas ref={canvas} role="img" aria-label={target ? `Live view of ${target}` : 'Live view of the app in use'} width={image.width} height={image.height} />}
      {image && cursor && <span data-testid="computer-preview-cursor" className="computer-preview__cursor" data-phase={cursor.phase} style={cursorPlace(cursor)} />}
    </div>
    <figcaption>
      <span role="status" aria-live="polite">{previewLabel(view)}</span>
      <button type="button" aria-label="Hide the live view in this conversation" title="Hide in this conversation" onClick={() => onHide('conversation')}>
        <Icon name="x" size={12} aria-hidden="true" />
      </button>
      <button type="button" aria-label="Hide the live view in all conversations" onClick={() => onHide('all')}>Hide always</button>
    </figcaption>
  </figure>;
}
