import { useEffect, useRef } from 'react';
import type { Block } from '@/lib/runner-session';
import { BlockView } from './block-view';

interface TranscriptProps {
  readonly blocks: ReadonlyArray<Block>;
}

/**
 * Scrollable transcript surface. Auto-scrolls to the bottom on new
 * blocks unless the user has scrolled up — in which case we surface a
 * "jump to latest" affordance so they don't get yanked away from where
 * they were reading.
 */
export function Transcript({ blocks }: TranscriptProps): JSX.Element {
  const scrollRef = useRef<HTMLDivElement>(null);
  const followRef = useRef(true);

  useEffect(() => {
    if (!followRef.current) return;
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [blocks]);

  const onScroll = (): void => {
    const el = scrollRef.current;
    if (!el) return;
    const slack = el.scrollHeight - el.scrollTop - el.clientHeight;
    // Within 32px of the bottom = "following". This tolerance keeps
    // following on even if a streaming chunk pushes the floor up
    // mid-render.
    followRef.current = slack < 32;
  };

  return (
    <div
      data-testid="transcript"
      ref={scrollRef}
      onScroll={onScroll}
      style={{
        position: 'absolute',
        inset: 0,
        bottom: 96,
        overflowY: 'auto',
        padding: '1.5rem 2rem',
        display: 'flex',
        flexDirection: 'column',
        gap: '0.75rem',
      }}
    >
      {blocks.map((b) => (
        <BlockView key={b.id} block={b} />
      ))}
    </div>
  );
}
