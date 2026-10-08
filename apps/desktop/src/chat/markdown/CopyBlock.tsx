import { useRef, type ReactNode } from 'react';
import { Icon } from '@moxxy/desktop-ui';
import { useCopy } from '@/lib/useCopy';
import { blockText } from './block-text';

/**
 * A block of a message that can be copied on its own: a quotation, a code
 * block, a table. The control sits in the block's corner, outside the block's
 * own box, so it is never part of what is copied.
 */
export function CopyBlock({
  what,
  children,
}: {
  /** What the block is, for the control's name. */
  readonly what: 'quote' | 'code' | 'table';
  readonly children: ReactNode;
}): JSX.Element {
  const ref = useRef<HTMLDivElement>(null);
  const { copied, copy } = useCopy();
  const onCopy = (): void => {
    const body = ref.current?.firstElementChild;
    if (body instanceof HTMLElement) void copy(blockText(body));
  };
  return (
    <div ref={ref} className="md-block">
      {children}
      <button
        type="button"
        className="md-block__copy"
        data-copied={copied ? 'true' : undefined}
        aria-label={copied ? 'Copied' : `Copy ${what}`}
        onClick={onCopy}
      >
        <Icon name={copied ? 'check' : 'copy'} size={13} />
      </button>
    </div>
  );
}
