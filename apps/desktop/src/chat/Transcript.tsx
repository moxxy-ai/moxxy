import { memo, useEffect, useMemo, useRef } from 'react';
import type { MoxxyEvent } from '@moxxy/sdk';
import { blocksEquivalent, type Block as FoldedBlock } from '@moxxy/chat-model';
import { buildRenderNodes, type Extension } from '@/lib/useChat';
import { BlockView, StreamingAssistant } from './BlockView';
import { ExtensionCard } from './ExtensionCard';
import { ThinkingIndicator } from './ThinkingIndicator';

interface TranscriptProps {
  readonly events: ReadonlyArray<MoxxyEvent>;
  readonly extensions: ReadonlyArray<Extension>;
  readonly streamingText: string;
  readonly sending?: boolean;
  /** Forwarded into ExtensionCard for the dismiss control. */
  readonly workspaceId?: string;
}

/** Memoised per-block so a streaming chunk (which only changes
 *  `streamingText`) doesn't repaint the whole settled transcript. */
const MemoBlock = memo(
  function MemoBlock({ block }: { readonly block: FoldedBlock }): JSX.Element | null {
    return <BlockView block={block} />;
  },
  (a, b) => blocksEquivalent(a.block, b.block),
);

export function Transcript({
  events,
  extensions,
  streamingText,
  sending,
  workspaceId,
}: TranscriptProps): JSX.Element {
  const ref = useRef<HTMLDivElement>(null);
  const follow = useRef(true);

  // Fold only when committed events / extensions change — never on a
  // streaming tick (the events array reference is stable across chunks).
  const nodes = useMemo(() => buildRenderNodes(events, extensions), [events, extensions]);

  useEffect(() => {
    if (!follow.current) return;
    const el = ref.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [nodes, streamingText]);

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
      {nodes.map((node) =>
        node.kind === 'ext' ? (
          <ExtensionCard key={node.ext.id} ext={node.ext} workspaceId={workspaceId} />
        ) : (
          <MemoBlock key={node.block.id} block={node.block} />
        ),
      )}
      {streamingText && <StreamingAssistant text={streamingText} />}
      {sending && streamingText === '' && <ThinkingIndicator />}
    </div>
  );
}
