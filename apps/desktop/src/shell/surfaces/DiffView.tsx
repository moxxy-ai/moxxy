/**
 * Unified-diff renderer. Git supplies the patch structure; the selected file's
 * extension supplies the Prism grammar for code inside +/-/context rows.
 */

import { highlightedSyntax, useSyntaxGrammar } from './SyntaxHighlight';

/** Cap the DOM nodes materialized for a single diff. The server already caps
 *  `git.diff`, but a near-cap diff (many thousands of lines) rendered as one
 *  styled <div> per line can still briefly freeze the rail. Beyond this we stop
 *  and show a truncation note rather than mount unbounded nodes. */
const MAX_DIFF_LINES = 4000;
/** Syntax tokenization is deliberately stricter than the DOM-line cap: a very
 * large patch stays readable and scrollable, but falls back to plain diff ink
 * instead of spending a frame lexing hundreds of kilobytes. */
const MAX_HIGHLIGHTED_DIFF_CHARS = 250_000;

export function DiffView({ diff, path }: { readonly diff: string; readonly path: string }): JSX.Element {
  const syntax = useSyntaxGrammar(path);
  if (!diff.trim()) {
    return <Empty>No changes.</Empty>;
  }
  const allLines = diff.split('\n');
  const truncated = allLines.length > MAX_DIFF_LINES;
  const lines = truncated ? allLines.slice(0, MAX_DIFF_LINES) : allLines;
  const activeSyntax = diff.length <= MAX_HIGHLIGHTED_DIFF_CHARS ? syntax : null;
  return (
    <pre
      className="mono"
      style={{
        margin: 0,
        padding: 10,
        fontSize: 'var(--type-meta)',
        lineHeight: 1.5,
        overflow: 'auto',
        height: '100%',
        background: 'var(--color-input-soft)',
        borderRadius: 'var(--radius-block)',
        whiteSpace: 'pre',
      }}
    >
      {lines.map((line, i) => <DiffLine key={i} line={line} syntax={activeSyntax} />)}
      {truncated && (
        <div style={{ color: 'var(--color-text-dim)', padding: '8px 0' }}>
          … diff truncated ({allLines.length - MAX_DIFF_LINES} more lines)
        </div>
      )}
    </pre>
  );
}

function DiffLine({
  line,
  syntax,
}: {
  readonly line: string;
  readonly syntax: ReturnType<typeof useSyntaxGrammar>;
}): JSX.Element {
  const metadata =
    line.startsWith('+++') ||
    line.startsWith('---') ||
    line.startsWith('diff ') ||
    line.startsWith('index ') ||
    line.startsWith('new file ') ||
    line.startsWith('deleted file ');
  if (metadata || line.startsWith('@@')) {
    return <div style={lineStyle(line)}>{line || ' '}</div>;
  }
  const marker = line[0];
  if (marker !== '+' && marker !== '-' && marker !== ' ') {
    return <div style={lineStyle(line)}>{line || ' '}</div>;
  }
  return (
    <div style={{ minWidth: 'max-content', display: 'flex', ...lineStyle(line) }}>
      <span className="diff-code__marker" aria-hidden="true">{marker}</span>
      <span>{highlightedSyntax(line.slice(1) || ' ', syntax)}</span>
    </div>
  );
}

function lineStyle(line: string): React.CSSProperties {
  if (line.startsWith('+++') || line.startsWith('---') || line.startsWith('diff ')) {
    return { color: 'var(--color-text-muted)', fontWeight: 700 };
  }
  if (line.startsWith('@@')) return { color: 'var(--color-reference)' };
  if (line.startsWith('+')) return { color: 'var(--color-diff-add-text)', background: 'var(--color-diff-add-bg)' };
  if (line.startsWith('-')) return { color: 'var(--color-diff-del-text)', background: 'var(--color-diff-del-bg)' };
  return { color: 'var(--color-text-muted)' };
}

function Empty({ children }: { readonly children: React.ReactNode }): JSX.Element {
  return (
    <div style={{ padding: 16, fontSize: 'var(--type-row)', color: 'var(--color-text-dim)' }}>{children}</div>
  );
}
