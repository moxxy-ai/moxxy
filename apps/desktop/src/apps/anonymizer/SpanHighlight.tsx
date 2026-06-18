import type { ReactNode } from 'react';
import type { PiiSpan } from '@moxxy/anonymizer';
import { CATEGORY_LABELS } from './labels';

/** Render `text` with detected spans highlighted in place. `spans` must be
 *  sorted ascending and non-overlapping (as `detect`/`redact` return them). */
export function SpanHighlight({
  text,
  spans,
}: {
  readonly text: string;
  readonly spans: readonly PiiSpan[];
}): JSX.Element {
  const parts: ReactNode[] = [];
  let cursor = 0;
  spans.forEach((s, i) => {
    if (s.start > cursor) parts.push(text.slice(cursor, s.start));
    parts.push(
      <mark
        key={i}
        title={CATEGORY_LABELS[s.category]}
        style={{
          background: 'color-mix(in oklab, var(--color-primary) 22%, transparent)',
          color: 'inherit',
          borderRadius: 3,
          padding: '0 1px',
        }}
      >
        {text.slice(s.start, s.end)}
      </mark>,
    );
    cursor = s.end;
  });
  if (cursor < text.length) parts.push(text.slice(cursor));

  return (
    <pre
      style={{
        margin: 0,
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-word',
        fontFamily: 'inherit',
        fontSize: 13,
        lineHeight: 1.5,
      }}
    >
      {parts}
    </pre>
  );
}
