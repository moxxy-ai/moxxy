import { useEffect, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from '@moxxy/desktop-ui';
import { imagePreviewSrc, type ImagePreviewItem } from './types';

const MIN_SCALE = 0.5;
const MAX_SCALE = 3;
const SCALE_STEP = 0.25;

function clampScale(value: number): number {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, value));
}

export function ImagePreviewModal({
  image,
  onClose,
}: {
  readonly image: ImagePreviewItem | null;
  readonly onClose: () => void;
}): JSX.Element | null {
  const [scale, setScale] = useState(1);

  useEffect(() => {
    setScale(1);
  }, [image]);

  useEffect(() => {
    if (!image) return;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [image, onClose]);

  if (!image) return null;

  const percent = `${Math.round(scale * 100)}%`;
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
          src={imagePreviewSrc(image)}
          alt={image.name}
          draggable={false}
          style={{
            maxWidth: 'min(100%, 1440px)',
            maxHeight: '100%',
            objectFit: 'contain',
            transform: `scale(${scale})`,
            transformOrigin: 'center',
            transition: 'transform 140ms ease',
            borderRadius: 8,
            boxShadow: '0 24px 80px rgba(0,0,0,0.45)',
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
