import { useState } from 'react';
import type { ReasoningMessageEvent } from '@moxxy/sdk';
import { Icon } from '@moxxy/desktop-ui';
import { MarkdownBody } from '../MarkdownBody';

/**
 * The model's thinking before the calls or the answer that follow it. Folded
 * and quiet by default; opening it shows the summary. Withheld reasoning has
 * nothing to open, so one line stands in for it.
 */
export function ReasoningBlock({ event }: { readonly event: ReasoningMessageEvent }): JSX.Element {
  const [open, setOpen] = useState(false);

  if (event.redacted) {
    return (
      <div className="reasoning reasoning--withheld" data-testid="block-reasoning">
        Reasoning withheld
      </div>
    );
  }

  return (
    <div className="reasoning" data-testid="block-reasoning">
      <button
        type="button"
        className="reasoning__toggle"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <span className="reasoning__chevron" data-open={open} aria-hidden>
          <Icon name="chevron-right" size={12} />
        </span>
        <span className="reasoning__label">Thinking</span>
      </button>
      {open && (
        <div className="reasoning__body">
          <MarkdownBody text={event.content} />
        </div>
      )}
    </div>
  );
}
