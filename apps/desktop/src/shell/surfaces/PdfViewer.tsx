import { Button } from '@moxxy/desktop-ui';
import { useState } from 'react';

type PdfFit = 'width' | 'page';

function fileName(path: string): string {
  return path.split(/[\\/]/).pop() ?? 'document.pdf';
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const mb = bytes / (1024 * 1024);
  if (mb >= 1) return `${mb.toFixed(mb >= 10 ? 0 : 1)} MB`;
  return `${Math.round(bytes / 1024)} KB`;
}

/** Chromium's offline PDF viewer with app-native framing and fit controls. */
export function PdfViewer({
  url,
  path,
  byteLength,
}: {
  readonly url: string;
  readonly path: string;
  readonly byteLength: number;
}): JSX.Element {
  const [fit, setFit] = useState<PdfFit>('width');
  const src = `${url}#view=${fit === 'width' ? 'FitH' : 'Fit'}&toolbar=1&navpanes=0`;

  return (
    <div className="file-preview">
      <header className="file-preview__toolbar file-preview__toolbar--pdf">
        <span className="file-preview__kind">
          PDF <span className="file-preview__bytes">· {formatBytes(byteLength)}</span>
        </span>
        <span className="file-preview__spacer" style={{ flex: 1 }} />
        <Button
          variant="ghost"
          aria-label="Fit width"
          aria-pressed={fit === 'width'}
          onClick={() => setFit('width')}
          style={fit === 'width' ? activeTool : undefined}
        >
          <span className="file-preview__label--full">Fit width</span>
          <span className="file-preview__label--compact" aria-hidden="true">Width</span>
        </Button>
        <Button
          variant="ghost"
          aria-label="Fit page"
          aria-pressed={fit === 'page'}
          onClick={() => setFit('page')}
          style={fit === 'page' ? activeTool : undefined}
        >
          <span className="file-preview__label--full">Fit page</span>
          <span className="file-preview__label--compact" aria-hidden="true">Page</span>
        </Button>
        <a
          className="moxxy-btn btn-outline file-preview__download"
          href={url}
          download={fileName(path)}
          aria-label="Download"
        >
          <span className="file-preview__label--full">Download</span>
          <span className="file-preview__label--compact" aria-hidden="true">Save</span>
        </a>
      </header>
      <iframe
        key={fit}
        src={src}
        title={path}
        className="file-preview__frame"
      />
    </div>
  );
}

const activeTool: React.CSSProperties = {
  color: 'var(--color-primary)',
  background: 'var(--color-primary-soft)',
};
