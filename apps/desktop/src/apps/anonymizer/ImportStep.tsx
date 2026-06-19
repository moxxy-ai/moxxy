import { useState } from 'react';
import { Button, Icon, TextArea } from '@moxxy/desktop-ui';
import { Segmented } from '../../shell/ViewHeader';

export type ImportTab = 'upload' | 'paste';

const SUPPORTED =
  'PDF, Word (.doc/.docx), RTF, OpenDocument (.odt/.ods/.odp), spreadsheets, slides, and plain text.';

/**
 * Step 1 — Import. A guided input step: toggle between "Upload a document" and
 * "Paste text". Upload offers a drag-and-drop dropzone AND a "Choose file…"
 * button; once a file is loaded it shows the name + a Replace / Clear affordance.
 *
 * Pure presentation — the parent owns the text/filename state and the actual
 * parse IPC (so the offline guarantee + drop-bytes handling stay in one place).
 */
export function ImportStep({
  tab,
  onTab,
  text,
  onText,
  fileName,
  busy,
  error,
  dragActive,
  onPick,
  onClear,
  onDrop,
  onDragOver,
  onDragLeave,
}: {
  readonly tab: ImportTab;
  readonly onTab: (t: ImportTab) => void;
  readonly text: string;
  readonly onText: (t: string) => void;
  readonly fileName: string | null;
  readonly busy: boolean;
  readonly error: string | null;
  readonly dragActive: boolean;
  readonly onPick: () => void;
  readonly onClear: () => void;
  readonly onDrop: (e: React.DragEvent) => void;
  readonly onDragOver: (e: React.DragEvent) => void;
  readonly onDragLeave: (e: React.DragEvent) => void;
}): JSX.Element {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <Segmented
        items={[
          { id: 'upload', label: 'Upload a document' },
          { id: 'paste', label: 'Paste text' },
        ]}
        value={tab}
        onChange={onTab}
        testIdPrefix="anon-src-"
      />

      {tab === 'upload' ? (
        fileName ? (
          <LoadedFile fileName={fileName} chars={text.length} busy={busy} onReplace={onPick} onClear={onClear} />
        ) : (
          <Dropzone
            busy={busy}
            dragActive={dragActive}
            onPick={onPick}
            onDrop={onDrop}
            onDragOver={onDragOver}
            onDragLeave={onDragLeave}
          />
        )
      ) : (
        <PasteArea text={text} onText={onText} />
      )}

      {error && (
        <div
          data-testid="anon-import-error"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '8px 12px',
            fontSize: 12.5,
            color: 'var(--color-red-text)',
            background: 'var(--color-red-wash)',
            border: '1px solid var(--color-red-border)',
            borderRadius: 10,
          }}
        >
          <Icon name="x" size={14} />
          {error}
        </div>
      )}
    </div>
  );
}

function Dropzone({
  busy,
  dragActive,
  onPick,
  onDrop,
  onDragOver,
  onDragLeave,
}: {
  readonly busy: boolean;
  readonly dragActive: boolean;
  readonly onPick: () => void;
  readonly onDrop: (e: React.DragEvent) => void;
  readonly onDragOver: (e: React.DragEvent) => void;
  readonly onDragLeave: (e: React.DragEvent) => void;
}): JSX.Element {
  return (
    <div
      data-testid="anon-dropzone"
      onDrop={onDrop}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 12,
        padding: '2rem 1.5rem',
        textAlign: 'center',
        border: `1.5px dashed ${dragActive ? 'var(--color-accent)' : 'var(--color-card-border-strong)'}`,
        borderRadius: 'var(--radius-block)',
        background: dragActive
          ? 'color-mix(in oklab, var(--color-accent) 8%, transparent)'
          : 'var(--color-input-soft)',
        transition: 'border-color 140ms, background 140ms',
      }}
    >
      <span
        aria-hidden
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 44,
          height: 44,
          borderRadius: 12,
          color: 'var(--color-accent-strong)',
          background: 'color-mix(in oklab, var(--color-accent) 12%, transparent)',
        }}
      >
        <Icon name="attach" size={20} />
      </span>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
        <strong style={{ fontSize: 14 }}>
          {dragActive ? 'Drop to load your document' : 'Drag & drop a document here'}
        </strong>
        <span style={{ fontSize: 12.5, color: 'var(--color-text-muted)' }}>or</span>
      </div>
      <Button variant="primary" data-testid="anon-pick" onClick={onPick} disabled={busy}>
        <Icon name="attach" size={14} /> Choose a file…
      </Button>
      {busy ? (
        <span style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>Reading document…</span>
      ) : (
        <span style={{ fontSize: 11.5, color: 'var(--color-text-dim)', maxWidth: 420 }}>
          Supports {SUPPORTED}
        </span>
      )}
    </div>
  );
}

function LoadedFile({
  fileName,
  chars,
  busy,
  onReplace,
  onClear,
}: {
  readonly fileName: string;
  readonly chars: number;
  readonly busy: boolean;
  readonly onReplace: () => void;
  readonly onClear: () => void;
}): JSX.Element {
  return (
    <div
      data-testid="anon-loaded-file"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '12px 14px',
        border: '1px solid var(--color-card-border)',
        borderRadius: 'var(--radius-block)',
        background: 'var(--color-surface)',
      }}
    >
      <span
        aria-hidden
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 36,
          height: 36,
          flexShrink: 0,
          borderRadius: 9,
          color: 'var(--color-green)',
          background: 'var(--color-green-soft)',
        }}
      >
        <Icon name="file" size={18} />
      </span>
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
        <strong
          data-testid="anon-file-name"
          style={{
            fontSize: 13.5,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {fileName}
        </strong>
        <span style={{ fontSize: 11.5, color: 'var(--color-text-dim)' }}>
          {busy ? 'Reading document…' : `${chars.toLocaleString()} characters loaded`}
        </span>
      </div>
      <Button variant="secondary" data-testid="anon-replace" onClick={onReplace} disabled={busy}>
        Replace
      </Button>
      <Button variant="ghost" data-testid="anon-clear" onClick={onClear} aria-label="Clear document">
        <Icon name="x" size={15} />
      </Button>
    </div>
  );
}

function PasteArea({
  text,
  onText,
}: {
  readonly text: string;
  readonly onText: (t: string) => void;
}): JSX.Element {
  // Keep a stable focus while typing — TextArea is uncontrolled-friendly here.
  const [touched, setTouched] = useState(false);
  return (
    <TextArea
      autoFocus
      data-testid="anon-paste"
      value={text}
      onChange={(e) => onText(e.target.value)}
      onBlur={() => setTouched(true)}
      placeholder="Paste the text you want to anonymize…"
      rows={10}
      tone="soft"
      style={{
        width: '100%',
        fontSize: 13,
        lineHeight: 1.55,
        minHeight: 200,
        borderColor: touched && !text ? 'var(--color-card-border)' : undefined,
      }}
    />
  );
}
