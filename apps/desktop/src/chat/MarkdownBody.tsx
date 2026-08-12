/**
 * Render assistant text as Markdown, restricted to safe blocks (no raw HTML).
 *
 * Everything here is tuned so a message reads as a MESSAGE and not as a document:
 * the heading scale is compressed (see `.prose h*` in styles.css), the rhythm is
 * expressed in em so it tracks the prose size, and the only elements that keep
 * the chrome face are the ones that are literally machine text — inline code and
 * code blocks. Links take `--color-reference`, the palette's hue for exactly this
 * (a citation is neither a state nor a command, so it may not have the accent).
 */

import { memo, useLayoutEffect, useRef, type MutableRefObject } from 'react';
import ReactMarkdown from 'react-markdown';
import { useStreamingMarkdownText } from './useStreamingMarkdownText';
import remarkGfm from 'remark-gfm';
import type { Components } from 'react-markdown';

const components: Components = {
  p: (p) => <p style={{ margin: '0 0 0.7em' }} {...p} />,
  ul: (p) => <ul style={{ margin: '0 0 0.7em', paddingLeft: '1.35em' }} {...p} />,
  ol: (p) => <ol style={{ margin: '0 0 0.7em', paddingLeft: '1.5em' }} {...p} />,
  li: (p) => <li style={{ margin: '0.15em 0' }} {...p} />,
  h1: (p) => (
    <h1 style={{ margin: '1em 0 0.35em' }} {...p} />
  ),
  h2: (p) => (
    <h2 style={{ margin: '1em 0 0.3em' }} {...p} />
  ),
  h3: (p) => (
    <h3 style={{ margin: '0.9em 0 0.25em' }} {...p} />
  ),
  a: (p) => (
    <a
      {...p}
      target="_blank"
      rel="noreferrer noopener"
      // Reference, not the accent. The accent means the human commanded it; a
      // link the agent cited is reference data, which is what this hue is for.
      style={{
        color: 'var(--color-reference)',
        textDecoration: 'underline',
        textUnderlineOffset: '0.15em',
      }}
    />
  ),
  code: ({ className, children, ...rest }) => {
    const isBlock = /language-/.test(className ?? '');
    if (!isBlock) {
      return (
        <code
          {...rest}
          className={className}
          style={{
            background: 'var(--color-code-bg)',
            border: '1px solid var(--color-card-border)',
            padding: '0 0.3em',
            borderRadius: 'var(--radius-chip)',
            // The chrome face has a larger apparent size than the prose face at
            // the same px, so inline code is stepped down to sit on the same line
            // without lifting the leading around it.
            fontSize: '0.86em',
            fontFamily: 'var(--font-mono)',
          }}
        >
          {children}
        </code>
      );
    }
    return (
      <code className={className} {...rest}>
        {children}
      </code>
    );
  },
  pre: (p) => (
    <pre
      {...p}
      style={{
        margin: '0 0 0.7em',
        padding: 'var(--space-8) var(--space-12)',
        background: 'var(--color-input-soft)',
        border: '1px solid var(--color-card-border)',
        borderRadius: 'var(--radius-block)',
        fontSize: 'var(--type-meta)',
        fontFamily: 'var(--font-mono)',
        overflowX: 'auto',
        lineHeight: 1.55,
      }}
    />
  ),
  // A quotation is reference material, so it reads as a recessed well rather than
  // as faded prose. It used to be muted text on a hairline, and because quoted
  // matter is usually emphasised at the source, the result was BOLD text in a
  // dim grey — which looks like something failed to load rather than like a pull
  // quote. Full-strength ink in a sunk well says "not my words" without dimming
  // the words themselves.
  blockquote: (p) => (
    <blockquote
      {...p}
      style={{
        margin: '0 0 0.7em',
        padding: '0.5em 0.85em',
        // A seam, not the accent. The accent means "the human commanded this",
        // and a quotation inside the agent's own prose is not that.
        borderLeft: '2px solid var(--color-card-border-strong)',
        borderRadius: '0 var(--radius-block) var(--radius-block) 0',
        background: 'var(--color-input-soft)',
        color: 'var(--color-text)',
      }}
    />
  ),
  hr: () => (
    <hr
      style={{
        border: 'none',
        borderTop: '1px solid var(--color-card-border)',
        margin: '1.1em 0',
      }}
    />
  ),
  // A table in a message is data, so it takes the chrome face and tabular
  // figures — columns of numbers in a proportional face do not line up, which is
  // the whole reason the chrome face exists in this language. It also scrolls
  // inside its own box: a wide table must never drag the page sideways.
  table: (p) => (
    <div style={{ margin: '0 0 0.7em', overflowX: 'auto' }}>
      <table
        {...p}
        style={{
          borderCollapse: 'collapse',
          fontFamily: 'var(--font-chrome)',
          fontSize: 'var(--type-meta)',
          fontVariantNumeric: 'tabular-nums',
        }}
      />
    </div>
  ),
  th: (p) => (
    <th
      {...p}
      style={{
        textAlign: 'left',
        padding: 'var(--space-4) var(--space-8)',
        borderBottom: '1px solid var(--color-card-border-strong)',
        fontWeight: 600,
        whiteSpace: 'nowrap',
        color: 'var(--color-text-muted)',
        fontSize: 'var(--type-label)',
        letterSpacing: '0.08em',
        textTransform: 'uppercase',
      }}
    />
  ),
  td: (p) => (
    <td
      {...p}
      style={{
        padding: 'var(--space-4) var(--space-8)',
        borderBottom: '1px solid var(--color-card-border)',
        verticalAlign: 'top',
      }}
    />
  ),
};

/**
 * The parse itself, isolated behind its own memo boundary.
 *
 * react-markdown re-parses whatever it is handed on EVERY render, so throttling
 * the string alone changes nothing — the parent still re-renders on every delta
 * and the parse runs again with identical input. Cutting the subtree here is
 * what turns an unchanged string into no work at all.
 */
const MarkdownContent = memo(function MarkdownContent({
  text,
  cost,
}: {
  readonly text: string;
  /** Written on every real parse; the throttle upstream reads it to decide how
   *  long to wait before asking for the next one. A ref, so handing it down
   *  costs nothing and never defeats the memo. */
  readonly cost: MutableRefObject<number>;
}) {
  const started = performance.now();
  useLayoutEffect(() => {
    cost.current = performance.now() - started;
  });
  return (
    <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
      {text}
    </ReactMarkdown>
  );
});

/**
 * Rendered Markdown for one message.
 *
 * MEMOISED, and that matters more than it looks: react-markdown re-parses from
 * scratch on every render, while a streaming turn re-renders the transcript on
 * every delta. Unmemoised, every visible message in the conversation re-parsed
 * on every delta — not just the one being written — which a CPU profile of a
 * live turn showed as the heaviest app-level cost in the renderer. The props
 * are a string and a boolean, so the default shallow comparison is exactly
 * right.
 */
export const MarkdownBody = memo(function MarkdownBody({
  text,
  streaming = false,
}: {
  readonly text: string;
  /** When true, attaches a blinking cursor via CSS ::after to the last
   *  rendered block so the tail of the streaming text doesn't jump to
   *  a new line. */
  readonly streaming?: boolean;
}): JSX.Element {
  const parseCost = useRef(0);
  const parsed = useStreamingMarkdownText(text, streaming, parseCost);
  return (
    // `prose` is the app's ONE proportional voice: the chrome face is the
    // default everywhere else, and rendered Markdown is the only long-form text
    // a person actually reads in paragraphs. Code inside it stays in the chrome
    // face (see the `code`/`pre` components above), so the contrast between what
    // a human wrote and what the machine emitted is carried by the typeface.
    <div
      className={streaming ? 'markdown-body prose streaming' : 'markdown-body prose'}
      style={{
        color: 'var(--color-text)',
        wordBreak: 'break-word',
        // A measure, not the full column width. Long-form text past roughly 70
        // characters per line costs the eye the return sweep.
        maxWidth: '70ch',
      }}
    >
      <MarkdownContent text={parsed} cost={parseCost} />
    </div>
  );
});
