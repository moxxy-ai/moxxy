import { useEffect, useMemo, useState } from 'react';
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
import { useNer } from './ner/useNer';

const REDACT_MODES: ReadonlyArray<{ id: RedactionMode; label: string }> = [
  { id: 'label', label: 'Label' },
  { id: 'pseudonym', label: 'Pseudonym' },
  { id: 'hash', label: 'Hash' },
];

function parseTerms(s: string): string[] {
  return s
    .split(/[\n,]+/)
    .map((t) => t.trim())
    .filter(Boolean);
}

/**
 * Offline document anonymizer. Paste text or open a document, and the redaction
 * runs ENTIRELY in this renderer — structured PII via `@moxxy/anonymizer`
 * (pure, no network) plus on-device NER for names. Nothing is uploaded; opening
 * a file only reads it locally (in main) and returns the text here.
 */
export function AnonymizerApp({ onExit }: DesktopAppProps): JSX.Element {
  const anon = useAnonymizer();
  const { status: nerStatus, error: nerError, detectNames } = useNer();

  const [sourceMode, setSourceMode] = useState<'paste' | 'file'>('paste');
  const [input, setInput] = useState('');
  const [fileName, setFileName] = useState<string | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [categories, setCategories] = useState<ReadonlySet<PiiCategory>>(
    () => new Set(STRUCTURED_CATEGORIES),
  );
  const [customTermsText, setCustomTermsText] = useState('');
  const [mode, setMode] = useState<RedactionMode>('label');
  const [nerEnabled, setNerEnabled] = useState(true);
  const [nerSpans, setNerSpans] = useState<readonly PiiSpan[]>([]);
  const [saved, setSaved] = useState<string | null>(null);

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
  const categoryList = useMemo(() => [...categories], [categories]);

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

  const toggleCategory = (c: PiiCategory): void => {
    setCategories((prev) => {
      const next = new Set(prev);
      if (next.has(c)) next.delete(c);
      else next.add(c);
      return next;
    });
  };

  const openDocument = async (): Promise<void> => {
    setFileError(null);
    const r = await anon.pickAndParse();
    if (!r) return; // cancelled
    if ('error' in r) {
      setFileError(r.error);
      return;
    }
    setInput(r.text);
    setFileName('document');
  };

  const copyOut = (): void => {
    void navigator.clipboard.writeText(result.text);
  };

  const saveOut = async (): Promise<void> => {
    const name = fileName ? `${fileName}-redacted.txt` : 'redacted.txt';
    const path = await anon.save(name, result.text);
    if (path) setSaved(path);
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
          padding: '1.25rem 1.75rem',
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))',
          gap: '1.25rem',
        }}
      >
        {/* ── Source + options ─────────────────────────────────────────── */}
        <section style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem', minWidth: 0 }}>
          <Segmented
            items={[
              { id: 'paste', label: 'Paste text' },
              { id: 'file', label: 'Open document' },
            ]}
            value={sourceMode}
            onChange={(id) => setSourceMode(id)}
            testIdPrefix="anon-src-"
          />

          {sourceMode === 'paste' ? (
            <TextArea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Paste the text you want to anonymize…"
              rows={10}
              style={{ width: '100%', fontSize: 13, lineHeight: 1.5 }}
            />
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <Button variant="secondary" data-testid="anon-pick" onClick={() => void openDocument()}>
                <Icon name="attach" size={14} /> Choose a document…
              </Button>
              {anon.busy && <span style={dim}>Reading document…</span>}
              {fileName && !anon.busy && (
                <span style={dim}>Loaded {result.report.total} item(s) from your document.</span>
              )}
              {fileError && <span style={{ ...dim, color: 'var(--color-pink)' }}>{fileError}</span>}
            </div>
          )}

          <label style={toggleRow}>
            <input
              type="checkbox"
              checked={nerEnabled}
              onChange={(e) => setNerEnabled(e.target.checked)}
            />
            <span>Detect names &amp; places (on-device AI)</span>
            <span style={{ ...dim, marginLeft: 'auto' }}>
              {nerStatus === 'loading'
                ? 'loading model…'
                : nerStatus === 'error'
                  ? 'unavailable'
                  : nerStatus === 'ready'
                    ? 'ready'
                    : ''}
            </span>
          </label>
          {nerError && nerEnabled && (
            <span style={{ ...dim, color: 'var(--color-pink)' }}>{nerError}</span>
          )}

          <div>
            <div style={{ ...dim, marginBottom: 6 }}>Redaction style</div>
            <Segmented items={REDACT_MODES} value={mode} onChange={setMode} testIdPrefix="anon-mode-" />
          </div>

          <fieldset style={{ border: 'none', padding: 0, margin: 0 }}>
            <div style={{ ...dim, marginBottom: 6 }}>Detect</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 14px' }}>
              {TOGGLE_CATEGORIES.map((c) => (
                <label key={c} style={toggleRow}>
                  <input
                    type="checkbox"
                    checked={categories.has(c)}
                    onChange={() => toggleCategory(c)}
                  />
                  <span>{CATEGORY_LABELS[c]}</span>
                </label>
              ))}
            </div>
          </fieldset>

          <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span style={dim}>Always redact these terms (names, addresses — one per line)</span>
            <TextArea
              value={customTermsText}
              onChange={(e) => setCustomTermsText(e.target.value)}
              placeholder={'Jane Doe\n123 Main St\nAcme Corp'}
              rows={3}
              style={{ width: '100%', fontSize: 13 }}
            />
          </label>
        </section>

        {/* ── Result ───────────────────────────────────────────────────── */}
        <section style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', minWidth: 0 }}>
          <Counts counts={result.report.counts} total={result.report.total} />

          <div style={{ display: 'flex', gap: 8 }}>
            <Button variant="primary" data-testid="anon-copy" onClick={copyOut} disabled={!input}>
              <Icon name="copy" size={14} /> Copy redacted
            </Button>
            <Button variant="secondary" onClick={() => void saveOut()} disabled={!input}>
              Save…
            </Button>
          </div>
          {saved && <span style={dim}>Saved to {saved}</span>}

          <div style={panelBox}>
            <div style={{ ...dim, marginBottom: 6 }}>Redacted output</div>
            <pre data-testid="anon-output" style={preBox}>
              {result.text || (
                <span style={{ color: 'var(--color-text-dim)' }}>
                  The redacted text will appear here.
                </span>
              )}
            </pre>
          </div>

          {result.report.total > 0 && (
            <div style={panelBox}>
              <div style={{ ...dim, marginBottom: 6 }}>Detected in source</div>
              <SpanHighlight text={input} spans={result.report.spans} />
            </div>
          )}
        </section>
      </div>
    </>
  );
}

const dim: React.CSSProperties = { fontSize: 12, color: 'var(--color-text-dim)' };
const toggleRow: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 7,
  fontSize: 13,
  cursor: 'pointer',
};
const panelBox: React.CSSProperties = {
  border: '1px solid var(--color-border)',
  background: 'var(--color-bg-card)',
  borderRadius: 'var(--radius-block)',
  padding: '0.7rem 0.85rem',
};
const preBox: React.CSSProperties = {
  margin: 0,
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-word',
  fontFamily: 'inherit',
  fontSize: 13,
  lineHeight: 1.5,
  maxHeight: 360,
  overflowY: 'auto',
};
