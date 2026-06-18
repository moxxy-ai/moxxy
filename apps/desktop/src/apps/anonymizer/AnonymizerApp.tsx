import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  redact,
  STRUCTURED_CATEGORIES,
  type PiiCategory,
  type PiiSpan,
  type RedactionMode,
} from '@moxxy/anonymizer';
import { useAnonymizer } from '@moxxy/client-core';
import { Button, Icon, TextArea } from '@moxxy/desktop-ui';
import { Segmented, ViewHeader } from '../../shell/ViewHeader';
import type { DesktopAppProps } from '../registry';
import { OfflineBadge } from '../OfflineBadge';
import { Counts } from './Counts';
import { SpanHighlight } from './SpanHighlight';
import { CATEGORY_LABELS, TOGGLE_CATEGORIES } from './labels';
import { FilterSelect, type FilterOption } from './FilterSelect';
import { ImportStep, type ImportTab } from './ImportStep';
import { useNer } from './ner/useNer';

const REDACT_MODES: ReadonlyArray<{ id: RedactionMode; label: string }> = [
  { id: 'label', label: 'Label' },
  { id: 'pseudonym', label: 'Pseudonym' },
  { id: 'hash', label: 'Hash' },
];

/** A short description of what each redaction style produces, shown under the
 *  segmented control so the choice is obvious without trying each one. */
const MODE_HINT: Record<RedactionMode, string> = {
  label: 'Replaces each item with its type, e.g. [EMAIL].',
  pseudonym: 'Stable tokens, e.g. EMAIL_1 — the same value stays consistent.',
  hash: 'Compact fingerprints, e.g. [EMAIL:a1b2c3d4].',
};

/** Synthetic filter id the multi-select adds on top of the structured
 *  `PiiCategory` toggles: the NER group (names/orgs/locations). Custom terms
 *  are their own input below, so they aren't a filter row. */
const NAMES_FILTER = 'names' as const;
type FilterId = PiiCategory | typeof NAMES_FILTER;

function parseTerms(s: string): string[] {
  return s
    .split(/[\n,]+/)
    .map((t) => t.trim())
    .filter(Boolean);
}

/** Base64-encode bytes for the drag-and-drop parse IPC. Chunked so a large file
 *  doesn't exceed the argument-count limit of `String.fromCharCode(...)`. */
function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

/**
 * Offline document anonymizer — a guided three-step flow: Import → Settings →
 * Output. Redaction runs ENTIRELY in this renderer: structured PII via
 * `@moxxy/anonymizer` (pure, no network) plus on-device NER for names. Nothing
 * is uploaded; opening a file only reads it locally (in main) and returns the
 * text here.
 */
export function AnonymizerApp({ onExit }: DesktopAppProps): JSX.Element {
  const anon = useAnonymizer();
  const { status: nerStatus, error: nerError, detectNames } = useNer();

  const [importTab, setImportTab] = useState<ImportTab>('upload');
  const [input, setInput] = useState('');
  const [fileName, setFileName] = useState<string | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [dragActive, setDragActive] = useState(false);

  // Filters: structured categories + the NER `names` group, as a single set
  // driving the multi-select. Custom terms are a separate input but their
  // `custom` category is always on (the term box is its own switch).
  const [filters, setFilters] = useState<ReadonlySet<FilterId>>(
    () => new Set<FilterId>([...STRUCTURED_CATEGORIES, NAMES_FILTER]),
  );
  const [customTermsText, setCustomTermsText] = useState('');
  const [mode, setMode] = useState<RedactionMode>('label');
  const [nerSpans, setNerSpans] = useState<readonly PiiSpan[]>([]);
  const [saved, setSaved] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const nerEnabled = filters.has(NAMES_FILTER);
  const nerUnavailable = nerStatus === 'error';

  // Run on-device NER (debounced) whenever the text or the toggle changes.
  useEffect(() => {
    if (!nerEnabled || !input.trim()) {
      setNerSpans([]);
      return;
    }
    const handle = setTimeout(() => {
      void detectNames(input).then(setNerSpans);
    }, 350);
    return () => clearTimeout(handle);
  }, [input, nerEnabled, detectNames]);

  const customTerms = useMemo(() => parseTerms(customTermsText), [customTermsText]);
  const categoryList = useMemo(
    () => TOGGLE_CATEGORIES.filter((c) => filters.has(c)),
    [filters],
  );

  const result = useMemo(
    () =>
      redact(input, {
        categories: categoryList,
        customTerms,
        extraSpans: nerEnabled ? nerSpans : [],
        mode,
      }),
    [input, categoryList, customTerms, nerEnabled, nerSpans, mode],
  );

  const hasInput = input.trim().length > 0;

  const filterOptions = useMemo<ReadonlyArray<FilterOption<FilterId>>>(() => {
    const structured: FilterOption<FilterId>[] = TOGGLE_CATEGORIES.map((c) => ({
      id: c,
      label: CATEGORY_LABELS[c],
    }));
    const names: FilterOption<FilterId> = {
      id: NAMES_FILTER,
      label: 'Names, organizations & places',
      hint:
        nerStatus === 'loading'
          ? 'loading…'
          : nerStatus === 'error'
            ? 'unavailable'
            : 'on-device AI',
      disabled: nerUnavailable,
    };
    return [...structured, names];
  }, [nerStatus, nerUnavailable]);

  const applyParse = (r: { text: string } | { error: string }, name: string): void => {
    if ('error' in r) {
      setFileError(r.error);
      return;
    }
    setInput(r.text);
    setFileName(name);
  };

  const openDocument = async (): Promise<void> => {
    setFileError(null);
    const r = await anon.pickAndParse();
    if (!r) return; // cancelled
    applyParse(r, 'Document');
  };

  const clearDocument = (): void => {
    setInput('');
    setFileName(null);
    setFileError(null);
    setNerSpans([]);
  };

  // Drag-and-drop: read the dropped file's BYTES in the renderer (it already
  // has them — no filesystem access needed), base64-encode, and parse them in
  // main. We never send a path, so main can't be tricked into reading an
  // arbitrary file.
  const onDrop = (e: React.DragEvent): void => {
    e.preventDefault();
    setDragActive(false);
    setFileError(null);
    const file = e.dataTransfer.files?.[0];
    if (!file) return;
    void (async () => {
      try {
        const bytes = new Uint8Array(await file.arrayBuffer());
        applyParse(
          await anon.parseDroppedBytes(file.name || 'document', bytesToBase64(bytes)),
          file.name || 'Document',
        );
      } catch {
        setFileError('Could not read the dropped file.');
      }
    })();
  };

  const onDragOver = (e: React.DragEvent): void => {
    e.preventDefault();
    if (!dragActive) setDragActive(true);
  };
  const onDragLeave = (e: React.DragEvent): void => {
    e.preventDefault();
    setDragActive(false);
  };

  const copyOut = (): void => {
    void navigator.clipboard.writeText(result.text);
    setCopied(true);
    setSaved(null);
    window.setTimeout(() => setCopied(false), 1600);
  };

  const saveOut = async (): Promise<void> => {
    const base = fileName && fileName !== 'Document' ? fileName.replace(/\.[^.]+$/, '') : 'document';
    const path = await anon.save(`${base}-redacted.txt`, result.text);
    if (path) {
      setSaved(path);
      setCopied(false);
    }
  };

  return (
    <>
      <ViewHeader>
        <Button variant="chip" onClick={onExit} style={{ borderRadius: 9 }}>
          <Icon name="chevron-right" size={14} style={{ transform: 'rotate(180deg)' }} />
          Apps
        </Button>
        <strong style={{ fontSize: 15 }}>Document anonymizer</strong>
        <OfflineBadge />
        <span style={{ flex: 1 }} />
      </ViewHeader>

      <div
        style={{
          flex: 1,
          minHeight: 0,
          overflowY: 'auto',
          padding: '1.5rem 1.75rem 3rem',
        }}
      >
        <div
          style={{
            maxWidth: 1180,
            margin: '0 auto',
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(380px, 1fr))',
            gap: '1.5rem',
            alignItems: 'start',
          }}
        >
          {/* ── Stage 1 + 2 — Import & Settings ─────────────────────────── */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem', minWidth: 0 }}>
            <Stage n={1} title="Import" subtitle="Upload a document or paste text to anonymize.">
              <ImportStep
                tab={importTab}
                onTab={setImportTab}
                text={input}
                onText={setInput}
                fileName={importTab === 'upload' ? fileName : null}
                busy={anon.busy}
                error={fileError}
                dragActive={dragActive}
                onPick={() => void openDocument()}
                onClear={clearDocument}
                onDrop={onDrop}
                onDragOver={onDragOver}
                onDragLeave={onDragLeave}
              />
            </Stage>

            <Stage n={2} title="Settings" subtitle="Choose what to redact and how.">
              <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
                <Field label="Filters" help="Which kinds of information to find and redact.">
                  <FilterSelect options={filterOptions} selected={filters} onChange={setFilters} />
                  {nerEnabled && nerError && (
                    <span style={{ ...dim, color: 'var(--color-pink)', marginTop: 2 }}>
                      {nerError}
                    </span>
                  )}
                </Field>

                <Field label="Redaction style">
                  <Segmented
                    items={REDACT_MODES}
                    value={mode}
                    onChange={setMode}
                    testIdPrefix="anon-mode-"
                  />
                  <span style={{ ...dim, marginTop: 6 }}>{MODE_HINT[mode]}</span>
                </Field>

                <Field
                  label="Always redact these terms"
                  help="Specific names, addresses or codes — one per line."
                >
                  <TextArea
                    value={customTermsText}
                    onChange={(e) => setCustomTermsText(e.target.value)}
                    placeholder={'Jane Doe\n123 Main St\nAcme Corp'}
                    rows={3}
                    tone="soft"
                    style={{ width: '100%', fontSize: 13 }}
                  />
                </Field>
              </div>
            </Stage>
          </div>

          {/* ── Stage 3 — Output ─────────────────────────────────────────── */}
          <Stage n={3} title="Output" subtitle="Your redacted text, ready to copy or save.">
            {!hasInput ? (
              <EmptyOutput />
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                <Counts counts={result.report.counts} total={result.report.total} />

                <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                  <Button variant="primary" data-testid="anon-copy" onClick={copyOut}>
                    <Icon name={copied ? 'check' : 'copy'} size={14} />
                    {copied ? 'Copied' : 'Copy redacted'}
                  </Button>
                  <Button variant="secondary" data-testid="anon-save" onClick={() => void saveOut()}>
                    Save as…
                  </Button>
                  {saved && (
                    <span style={{ ...dim, display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                      <Icon name="check" size={13} /> Saved to {saved}
                    </span>
                  )}
                </div>

                <Panel label="Redacted text">
                  <pre data-testid="anon-output" style={preBox}>
                    {result.text}
                  </pre>
                </Panel>

                {result.report.total > 0 && (
                  <Panel label="What was detected">
                    <div style={{ maxHeight: 280, overflowY: 'auto' }}>
                      <SpanHighlight text={input} spans={result.report.spans} />
                    </div>
                  </Panel>
                )}
              </div>
            )}
          </Stage>
        </div>
      </div>
    </>
  );
}

/** A numbered stage card — the spine of the guided flow. The badge + title give
 *  each of Import / Settings / Output the same legible visual weight. */
function Stage({
  n,
  title,
  subtitle,
  children,
}: {
  readonly n: number;
  readonly title: string;
  readonly subtitle: string;
  readonly children: ReactNode;
}): JSX.Element {
  return (
    <section
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 16,
        minWidth: 0,
        padding: '1.1rem 1.25rem 1.25rem',
        border: '1px solid var(--color-card-border)',
        borderRadius: 'var(--radius-card)',
        background: 'var(--color-card-bg)',
        boxShadow: '0 1px 2px var(--color-card-shadow)',
      }}
    >
      <header style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <span
          aria-hidden
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 28,
            height: 28,
            flexShrink: 0,
            borderRadius: 999,
            fontSize: 13,
            fontWeight: 700,
            color: '#fff',
            background: 'var(--color-primary-strong)',
          }}
        >
          {n}
        </span>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
          <strong style={{ fontSize: 15 }}>{title}</strong>
          <span style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>{subtitle}</span>
        </div>
      </header>
      {children}
    </section>
  );
}

/** A labelled settings field — a small caption + optional help line above its
 *  control, so Settings reads as a clean form. */
function Field({
  label,
  help,
  children,
}: {
  readonly label: string;
  readonly help?: string;
  readonly children: ReactNode;
}): JSX.Element {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--color-text)' }}>{label}</span>
        {help && <span style={dim}>{help}</span>}
      </div>
      {children}
    </div>
  );
}

function Panel({ label, children }: { readonly label: string; readonly children: ReactNode }): JSX.Element {
  return (
    <div style={panelBox}>
      <div style={{ ...dim, fontWeight: 600, marginBottom: 8 }}>{label}</div>
      {children}
    </div>
  );
}

function EmptyOutput(): JSX.Element {
  return (
    <div
      data-testid="anon-output-empty"
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 12,
        minHeight: 220,
        textAlign: 'center',
        color: 'var(--color-text-dim)',
      }}
    >
      <span
        aria-hidden
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 48,
          height: 48,
          borderRadius: 14,
          color: 'var(--color-text-muted)',
          background: 'var(--color-input-soft)',
          border: '1px solid var(--color-card-border)',
        }}
      >
        <Icon name="file" size={22} />
      </span>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
        <strong style={{ fontSize: 13.5, color: 'var(--color-text-muted)' }}>
          Nothing to redact yet
        </strong>
        <span style={{ fontSize: 12.5 }}>Import a document or paste text to see the result here.</span>
      </div>
    </div>
  );
}

const dim: React.CSSProperties = { fontSize: 12, color: 'var(--color-text-dim)' };
const panelBox: React.CSSProperties = {
  border: '1px solid var(--color-card-border)',
  background: 'var(--color-surface)',
  borderRadius: 'var(--radius-block)',
  padding: '0.75rem 0.9rem',
};
const preBox: React.CSSProperties = {
  margin: 0,
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-word',
  fontFamily: 'inherit',
  fontSize: 13,
  lineHeight: 1.55,
  maxHeight: 360,
  overflowY: 'auto',
};
