import { useState } from 'react';
import { Button } from '@moxxy/desktop-ui';
import { MarkdownBody } from '@/chat/MarkdownBody';
import { SyntaxCode } from './SyntaxHighlight';

const OFFICE_EXTENSIONS = new Set([
  '.doc', '.docx', '.xlsx', '.pptx', '.odt', '.ods', '.odp', '.rtf',
]);

function extension(path: string): string {
  const name = path.split(/[\\/]/).pop() ?? '';
  const dot = name.lastIndexOf('.');
  return dot < 0 ? '' : name.slice(dot).toLowerCase();
}

export function TextFilePreview({
  path,
  content,
  truncated,
}: {
  readonly path: string;
  readonly content: string;
  readonly truncated: boolean;
}): JSX.Element {
  const ext = extension(path);
  const markdown = ext === '.md' || ext === '.mdx';
  const extractedDocument = OFFICE_EXTENSIONS.has(ext);
  const [preview, setPreview] = useState(markdown || extractedDocument);

  if (!markdown && !extractedDocument) {
    return <SyntaxCode path={path} content={content} truncated={truncated} />;
  }

  return (
    <div className="file-preview">
      <header className="file-preview__toolbar">
        <span className="file-preview__kind">
          {extractedDocument ? `${ext.slice(1).toUpperCase()} · extracted text` : 'Markdown'}
        </span>
        {markdown && (
          <>
            <span style={{ flex: 1 }} />
            <Button
              variant="ghost"
              aria-pressed={!preview}
              onClick={() => setPreview(false)}
              style={!preview ? activeTool : undefined}
            >
              Source
            </Button>
            <Button
              variant="ghost"
              aria-pressed={preview}
              onClick={() => setPreview(true)}
              style={preview ? activeTool : undefined}
            >
              Preview
            </Button>
          </>
        )}
      </header>
      <div className={preview ? 'file-preview__document prose' : 'file-preview__source'}>
        {preview ? (
          extractedDocument ? (
            <p style={{ margin: 0, whiteSpace: 'pre-wrap' }}>
              {content}
              {truncated ? '\n\n… (truncated)' : ''}
            </p>
          ) : (
            <>
              <MarkdownBody text={content} />
              {truncated && <p className="file-preview__truncated">… (truncated)</p>}
            </>
          )
        ) : (
          <SyntaxCode path={path} content={content} truncated={truncated} />
        )}
      </div>
    </div>
  );
}

const activeTool: React.CSSProperties = {
  color: 'var(--color-primary)',
  background: 'var(--color-primary-soft)',
};
