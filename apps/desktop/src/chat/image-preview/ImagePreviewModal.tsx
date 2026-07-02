import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
} from 'react';
import { createPortal } from 'react-dom';
import { Icon } from '@moxxy/desktop-ui';
import { imagePreviewSrc, type ImagePreviewItem } from './types';

const MIN_SCALE = 0.5;
const MAX_SCALE = 3;
const SCALE_STEP = 0.25;
const CENTER_PAN = Object.freeze({ x: 0, y: 0 });

function clampScale(value: number): number {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, value));
}

interface PanPoint {
  readonly x: number;
  readonly y: number;
}

interface DragState {
  readonly startPointer: PanPoint;
  readonly startPan: PanPoint;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function samePan(a: PanPoint, b: PanPoint): boolean {
  return a.x === b.x && a.y === b.y;
}

function clampPan(
  next: PanPoint,
  scale: number,
  image: HTMLImageElement | null,
  viewport: HTMLDivElement | null,
): PanPoint {
  if (scale <= 1 || !image || !viewport) return CENTER_PAN;
  const imageWidth = image.clientWidth || image.naturalWidth;
  const imageHeight = image.clientHeight || image.naturalHeight;
  const viewportWidth = viewport.clientWidth;
  const viewportHeight = viewport.clientHeight;
  const maxX = Math.max(0, (imageWidth * scale - viewportWidth) / 2);
  const maxY = Math.max(0, (imageHeight * scale - viewportHeight) / 2);
  return {
    x: clamp(next.x, -maxX, maxX),
    y: clamp(next.y, -maxY, maxY),
  };
}

export function ImagePreviewModal({
  image,
  onClose,
}: {
  readonly image: ImagePreviewItem | null;
  readonly onClose: () => void;
}): JSX.Element | null {
  const [scale, setScale] = useState(1);
  const [pan, setPan] = useState<PanPoint>(CENTER_PAN);
  const [dragging, setDragging] = useState(false);
  const imageRef = useRef<HTMLImageElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<DragState | null>(null);

  useEffect(() => {
    setScale(1);
    setPan(CENTER_PAN);
    setDragging(false);
    dragRef.current = null;
  }, [image]);

  useEffect(() => {
    setPan((current) => {
      const next = scale <= 1
        ? CENTER_PAN
        : clampPan(current, scale, imageRef.current, viewportRef.current);
      return samePan(current, next) ? current : next;
    });
  }, [scale]);

  useEffect(() => {
    if (!image) return;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [image, onClose]);

  useEffect(() => {
    if (!dragging) return undefined;
    const onMove = (event: MouseEvent): void => {
      const drag = dragRef.current;
      if (!drag) return;
      event.preventDefault();
      setPan(
        clampPan(
          {
            x: drag.startPan.x + event.clientX - drag.startPointer.x,
            y: drag.startPan.y + event.clientY - drag.startPointer.y,
          },
          scale,
          imageRef.current,
          viewportRef.current,
        ),
      );
    };
    const onUp = (): void => {
      dragRef.current = null;
      setDragging(false);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    return () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
  }, [dragging, scale]);

  const beginDrag = useCallback(
    (event: ReactMouseEvent<HTMLImageElement>): void => {
      if (scale <= 1 || event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();
      dragRef.current = {
        startPointer: { x: event.clientX, y: event.clientY },
        startPan: pan,
      };
      setDragging(true);
    },
    [pan, scale],
  );

  if (!image) return null;

  const percent = `${Math.round(scale * 100)}%`;
  const canPan = scale > 1;
  const modal = (
    <div
      data-testid="image-preview-backdrop"
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 1200,
        background: 'rgba(0, 0, 0, 0.86)',
        display: 'grid',
        placeItems: 'center',
        padding: '72px 72px 86px',
      }}
    >
      <div
        ref={viewportRef}
        role="dialog"
        aria-modal="true"
        aria-label={image.name}
        onClick={(event) => event.stopPropagation()}
        style={{
          position: 'relative',
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          overflow: 'hidden',
        }}
      >
        <img
          ref={imageRef}
          src={imagePreviewSrc(image)}
          alt={image.name}
          draggable={false}
          onMouseDown={beginDrag}
          style={{
            maxWidth: 'min(100%, 1440px)',
            maxHeight: '100%',
            objectFit: 'contain',
            transform: `translate(${pan.x}px, ${pan.y}px) scale(${scale})`,
            transformOrigin: 'center',
            transition: dragging ? 'none' : 'transform 140ms ease',
            borderRadius: 8,
            boxShadow: '0 24px 80px rgba(0,0,0,0.45)',
            cursor: dragging ? 'grabbing' : canPan ? 'grab' : 'default',
            userSelect: 'none',
            willChange: canPan ? 'transform' : undefined,
          }}
        />
      </div>
      <button
        type="button"
        aria-label="Close image preview"
        onClick={(event) => {
          event.stopPropagation();
          onClose();
        }}
        style={{
          position: 'fixed',
          top: 18,
          right: 18,
          width: 44,
          height: 44,
          borderRadius: '50%',
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: '#f8fafc',
          background: 'rgba(255,255,255,0.14)',
          border: '1px solid rgba(255,255,255,0.12)',
          boxShadow: '0 10px 30px rgba(0,0,0,0.28)',
        }}
      >
        <Icon name="x" size={20} />
      </button>
      <div
        onClick={(event) => event.stopPropagation()}
        style={{
          position: 'fixed',
          left: '50%',
          bottom: 22,
          transform: 'translateX(-50%)',
          display: 'inline-flex',
          alignItems: 'center',
          gap: 10,
          padding: '8px 10px',
          borderRadius: 999,
          background: 'rgba(30, 30, 34, 0.92)',
          border: '1px solid rgba(255,255,255,0.12)',
          color: '#f8fafc',
          boxShadow: '0 14px 36px rgba(0,0,0,0.35)',
        }}
      >
        <button
          type="button"
          aria-label="Zoom out"
          onClick={() => setScale((value) => clampScale(value - SCALE_STEP))}
          style={zoomButtonStyle}
        >
          -
        </button>
        <span
          className="mono"
          style={{ minWidth: 44, textAlign: 'center', fontSize: 13, fontWeight: 700 }}
        >
          {percent}
        </span>
        <button
          type="button"
          aria-label="Zoom in"
          onClick={() => setScale((value) => clampScale(value + SCALE_STEP))}
          style={zoomButtonStyle}
        >
          +
        </button>
      </div>
    </div>
  );

  return createPortal(modal, document.body);
}

const zoomButtonStyle: CSSProperties = {
  width: 34,
  height: 34,
  borderRadius: '50%',
  background: 'rgba(255,255,255,0.14)',
  color: '#f8fafc',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  fontSize: 20,
  lineHeight: 1,
  fontWeight: 700,
};
