import { useEffect, useRef } from 'react';
import type { Block } from '@/lib/useChat';
import { BlockView } from './BlockView';

/**
 * Auto-scrolling transcript. Stays glued to the bottom while new
 * blocks arrive unless the user has scrolled up — then we leave them
 * alone so they can read history without being yanked.
 *
 * Renders inside the chat card; padding here is content-side spacing,
 * not the card chrome.
 */
export function Transcript({
  blocks,
}: {
  readonly blocks: ReadonlyArray<Block>;
}): JSX.Element {
  const ref = useRef<HTMLDivElement>(null);
  const follow = useRef(true);
  // Track total streaming-text length so the auto-scroll also re-runs
  // on each assistant_chunk, not only when a new block is pushed.
  const streamLen = blocks
    .filter((b) => b.kind === 'assistant')
    .reduce((acc, b) => acc + (b.kind === 'assistant' ? b.text.length : 0), 0);

  useEffect(() => {
    if (!follow.current) return;
    const el = ref.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [blocks.length, streamLen]);

  const onScroll = (): void => {
    const el = ref.current;
    if (!el) return;
    const slack = el.scrollHeight - el.scrollTop - el.clientHeight;
    follow.current = slack < 32;
  };

  return (
    <div
      ref={ref}
      data-testid="transcript"
      onScroll={onScroll}
      style={{
        flex: 1,
        overflowY: 'auto',
        padding: '20px 24px 12px',
        display: 'flex',
        flexDirection: 'column',
        gap: 16,
      }}
    >
      {blocks.map((b) => (
        <BlockView key={b.id} block={b} />
      ))}
    </div>
  );
}
