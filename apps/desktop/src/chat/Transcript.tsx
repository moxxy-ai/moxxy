import { memo, useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Virtuoso, type VirtuosoHandle } from 'react-virtuoso';
import type { MoxxyEvent } from '@moxxy/sdk';
import { blocksEquivalent, IncrementalFold, type Block as FoldedBlock } from '@moxxy/chat-model';
import { buildRenderNodes, groupToolNodes, type Extension, type RenderNode } from '@moxxy/client-core';
import { BlockView, StreamingAssistant } from './BlockView';
import { ToolGroupView } from './ToolGroupView';
import { ExtensionCard } from './ExtensionCard';
import { ThinkingIndicator } from './ThinkingIndicator';
import { StreamingReasoning } from './blocks/StreamingReasoning';
import { JumpToLatest, useNewContentBelow } from './JumpToLatest';

interface TranscriptProps {
  readonly events: ReadonlyArray<MoxxyEvent>;
  readonly extensions: ReadonlyArray<Extension>;
  readonly streamingText: string;
  /** Live thinking text for the active turn (reasoning models); shown as a
   *  dim preview before the answer text starts arriving. */
  readonly streamingReasoning?: string;
  readonly sending?: boolean;
  /** Forwarded into ExtensionCard for the dismiss control. */
  readonly workspaceId?: string;
  /** True when older history can be paged in by scrolling to the top. */
  readonly hasOlder?: boolean;
  /** Fired when the user scrolls to the top edge — load the older page. */
  readonly onReachedTop?: () => void;
  /** "Skip" on the live thinking indicator — aborts the current turn (there
   *  is no reasoning-only skip primitive). */
  readonly onSkip?: () => void;
}

/** Memoised per-block so a streaming chunk (which only changes
 *  `streamingText`) doesn't repaint settled rows. */
const MemoBlock = memo(
  function MemoBlock({ block }: { readonly block: FoldedBlock }): JSX.Element | null {
    return <BlockView block={block} />;
  },
  (a, b) => blocksEquivalent(a.block, b.block),
);

/** Row gutter — Virtuoso measures each item, so spacing rides on the row
 *  rather than a flex `gap`. Flex column so each block's `alignSelf`
 *  (user → right, tool → left, assistant → stretch) is honoured; in the
 *  old flat flex container it worked for free, but each virtualised row is
 *  its own element now. */
// Centered reading column (z.ai): each row's content is capped and centered
// so prose doesn't stretch edge-to-edge on a wide window. alignSelf inside
// still places user bubbles right / assistant text full-width within it.
const ROW: React.CSSProperties = {
  padding: '8px 24px',
  display: 'flex',
  flexDirection: 'column',
  width: '100%',
  maxWidth: 860,
  margin: '0 auto',
};

function keyOf(node: RenderNode): string {
  if (node.kind === 'ext') return node.ext.id;
  if (node.kind === 'tool-group') return node.id;
  return node.block.id;
}

function Row({ node, workspaceId }: { readonly node: RenderNode; readonly workspaceId?: string }): JSX.Element {
  return (
    <div style={ROW}>
      {node.kind === 'ext' ? (
        <ExtensionCard ext={node.ext} workspaceId={workspaceId} />
      ) : node.kind === 'tool-group' ? (
        <ToolGroupView tools={node.tools} />
      ) : (
        <MemoBlock block={node.block} />
      )}
    </div>
  );
}

/** Virtuoso's `firstItemIndex` must decrease by exactly the number of
 *  rows prepended so the scroll position stays anchored. Start high so it
 *  never goes negative across a long session of scroll-ups. */
const BASE_FIRST_INDEX = 1_000_000;

/**
 * Virtualised transcript. Only the visible window mounts to the DOM, so a
 * workspace with thousands of messages stays smooth. `followOutput` pins
 * to the latest turn unless the user scrolls up; `startReached` +
 * `firstItemIndex` page in older history (Phase 7 cursor pagination)
 * without jumping the scroll position.
 */
export function Transcript({
  events,
  extensions,
  streamingText,
  streamingReasoning = '',
  sending,
  workspaceId,
  hasOlder,
  onReachedTop,
  onSkip,
}: TranscriptProps): JSX.Element {
  // Fold only when committed events / extensions change — never on a
  // streaming tick (the events array reference is stable across chunks). The
  // IncrementalFold re-folds only the unsettled tail past its high-water mark
  // instead of re-walking the whole event log on every committed event (the
  // old O(n²)/turn behaviour); buildRenderNodes only consults it on the common
  // no-extension fast path, and the result stays byte-identical. The optional
  // chaining degrades gracefully to the (identical) un-cached slow path when
  // IncrementalFold is unavailable.
  const foldRef = useRef<IncrementalFold | null>(null);
  if (foldRef.current === null && typeof IncrementalFold === 'function') {
    foldRef.current = new IncrementalFold();
  }
  const nodes = useMemo(
    () => groupToolNodes(buildRenderNodes(events, extensions, foldRef.current ?? undefined)),
    [events, extensions],
  );

  const virtuosoRef = useRef<VirtuosoHandle>(null);

  // Mirrors Virtuoso's at-bottom flag. Starts true: `initialTopMostItemIndex`
  // mounts the list at the bottom, so the jump affordance must not flash
  // before the first `atBottomStateChange` callback lands.
  const [atBottom, setAtBottom] = useState(true);

  // Changes on APPENDS only (new last row or streaming chunk) — stable
  // across upward-pagination prepends, so paging in history never fakes an
  // unread hint or flickers the jump button.
  const lastKey = nodes.length > 0 ? keyOf(nodes[nodes.length - 1]!) : '';
  const newBelow = useNewContentBelow(atBottom, `${lastKey}:${streamingText.length}`);

  const jumpToLatest = useCallback(() => {
    // `align: 'end'` on the LAST index also accounts for the Footer (the
    // in-flight streaming bubble), landing fully at the bottom — which
    // flips `atBottom` back on and resumes `followOutput`.
    virtuosoRef.current?.scrollToIndex({ index: 'LAST', align: 'end', behavior: 'smooth' });
  }, []);

  // Track how many rows have been prepended so far and shift
  // firstItemIndex by that amount. Detect a prepend by finding where the
  // previous head row landed in the new list.
  const [firstItemIndex, setFirstItemIndex] = useState(BASE_FIRST_INDEX);
  const prevHeadKey = useRef<string | null>(null);
  useLayoutEffect(() => {
    const headKey = nodes.length > 0 ? keyOf(nodes[0]!) : null;
    if (prevHeadKey.current !== null && headKey !== prevHeadKey.current) {
      const idx = nodes.findIndex((n) => keyOf(n) === prevHeadKey.current);
      if (idx > 0) setFirstItemIndex((v) => v - idx);
    }
    prevHeadKey.current = headKey;
  }, [nodes]);

  return (
    // Relative wrapper so the jump-to-latest button can float over the
    // scroller without joining the virtualised content.
    <div style={{ position: 'relative', flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
      <Virtuoso<RenderNode>
        ref={virtuosoRef}
        data={nodes as RenderNode[]}
        data-testid="transcript"
        style={{ flex: 1 }}
        // Only follow when the user is already at the bottom (scrolling up to
        // read is never interrupted). A newly-committed line scrolls SMOOTHLY;
        // during active streaming we pin instantly ('auto') so rapid chunks
        // don't stack overlapping smooth-scroll animations into lag/jank.
        followOutput={(isAtBottom) => (isAtBottom ? (streamingText ? 'auto' : 'smooth') : false)}
        // ~80px of slack so trackpad jitter / a sub-row nudge near the bottom
        // doesn't flip stick-to-bottom off (default is a razor-thin 4px).
        atBottomThreshold={80}
        atBottomStateChange={setAtBottom}
        firstItemIndex={firstItemIndex}
        initialTopMostItemIndex={Math.max(0, nodes.length - 1)}
        {...(hasOlder && onReachedTop ? { startReached: onReachedTop } : {})}
        computeItemKey={(_i, node) => keyOf(node)}
        itemContent={(_i, node) => <Row node={node} workspaceId={workspaceId} />}
        components={{
          Footer: () => (
            <div style={{ padding: '0 24px 12px', width: '100%', maxWidth: 860, margin: '0 auto' }}>
              {streamingText ? (
                <StreamingAssistant text={streamingText} />
              ) : streamingReasoning ? (
                <StreamingReasoning text={streamingReasoning} onSkip={onSkip} />
              ) : sending ? (
                <ThinkingIndicator onSkip={onSkip} />
              ) : null}
            </div>
          ),
        }}
      />
      <JumpToLatest visible={!atBottom} unread={newBelow} onJump={jumpToLatest} />
    </div>
  );
}
