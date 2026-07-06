import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
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
import type { ImagePreviewItem } from './image-preview/types';

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
  readonly onPreviewImage?: (image: ImagePreviewItem) => void;
}

/** Memoised per-block so a streaming chunk (which only changes
 *  `streamingText`) doesn't repaint settled rows. */
const MemoBlock = memo(
  function MemoBlock({
    block,
    onPreviewImage,
  }: {
    readonly block: FoldedBlock;
    readonly onPreviewImage?: (image: ImagePreviewItem) => void;
  }): JSX.Element | null {
    return <BlockView block={block} onPreviewImage={onPreviewImage} />;
  },
  (a, b) => blocksEquivalent(a.block, b.block) && a.onPreviewImage === b.onPreviewImage,
);

/** Row gutter — Virtuoso measures each item, so spacing rides on the row
 *  rather than a flex `gap`. Flex column so each block's `alignSelf`
 *  (user → right, tool → left, assistant → stretch) is honoured; in the
 *  old flat flex container it worked for free, but each virtualised row is
 *  its own element now. */
const ROW: React.CSSProperties = { padding: '8px 24px', display: 'flex', flexDirection: 'column' };

function keyOf(node: RenderNode): string {
  if (node.kind === 'ext') return node.ext.id;
  if (node.kind === 'tool-group') return node.id;
  return node.block.id;
}

function toolAnchorId(node: RenderNode): string | null {
  if (node.kind === 'tool-group') return node.tools.at(-1)?.id ?? null;
  if (node.kind === 'block' && node.block.kind === 'tool-call') return node.block.id;
  return null;
}

function containsToolAnchor(node: RenderNode, anchorId: string): boolean {
  if (node.kind === 'tool-group') return node.tools.some((tool) => tool.id === anchorId);
  return node.kind === 'block' && node.block.kind === 'tool-call' && node.block.id === anchorId;
}

function findAnchoredIndex(nodes: ReadonlyArray<RenderNode>, previousHead: RenderNode): number {
  const previousKey = keyOf(previousHead);
  const exact = nodes.findIndex((node) => keyOf(node) === previousKey);
  if (exact >= 0) return exact;

  const anchorId = toolAnchorId(previousHead);
  if (!anchorId) return -1;
  return nodes.findIndex((node) => containsToolAnchor(node, anchorId));
}

function Row({
  node,
  workspaceId,
  onPreviewImage,
}: {
  readonly node: RenderNode;
  readonly workspaceId?: string;
  readonly onPreviewImage?: (image: ImagePreviewItem) => void;
}): JSX.Element {
  return (
    <div style={ROW}>
      {node.kind === 'ext' ? (
        <ExtensionCard ext={node.ext} workspaceId={workspaceId} />
      ) : node.kind === 'tool-group' ? (
        <ToolGroupView tools={node.tools} />
      ) : (
        <MemoBlock block={node.block} onPreviewImage={onPreviewImage} />
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
  onPreviewImage,
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
  const [atTop, setAtTop] = useState(false);

  // Changes on APPENDS only (new last row or streaming chunk) — stable
  // across upward-pagination prepends, so paging in history never fakes an
  // unread hint or flickers the jump button.
  const lastNode = nodes.length > 0 ? nodes[nodes.length - 1] : undefined;
  const lastKey = lastNode ? keyOf(lastNode) : '';
  const newBelow = useNewContentBelow(atBottom, `${lastKey}:${streamingText.length}`);

  const jumpToLatest = useCallback(() => {
    // `align: 'end'` on the LAST index also accounts for the Footer (the
    // in-flight streaming bubble), landing fully at the bottom — which
    // flips `atBottom` back on and resumes `followOutput`.
    virtuosoRef.current?.scrollToIndex({ index: 'LAST', align: 'end', behavior: 'auto' });
  }, []);

  // Virtuoso fires `startReached` on a top-edge transition. On cold start the
  // scroller can already be at the top before `hasOlder` flips on, so replay
  // the request when older history becomes available while the user is there.
  useEffect(() => {
    if (hasOlder && atTop && onReachedTop) onReachedTop();
  }, [atTop, hasOlder, nodes.length, onReachedTop]);

  // Track how many rows have been prepended so far and shift
  // firstItemIndex by that amount. Detect a prepend by finding where the
  // previous head row landed in the new list. Tool runs can merge across a
  // pagination boundary, so fall back to the previous head tool id when the
  // render-node key itself changes.
  const [firstItemIndex, setFirstItemIndex] = useState(BASE_FIRST_INDEX);
  const prevWorkspaceId = useRef<string | undefined>(workspaceId);
  const prevHeadNode = useRef<RenderNode | null>(null);
  useLayoutEffect(() => {
    const headNode = nodes[0] ?? null;
    if (prevWorkspaceId.current !== workspaceId) {
      prevWorkspaceId.current = workspaceId;
      prevHeadNode.current = headNode;
      setFirstItemIndex(BASE_FIRST_INDEX);
      return;
    }

    const previousHead = prevHeadNode.current;
    if (previousHead !== null && headNode !== null && keyOf(headNode) !== keyOf(previousHead)) {
      const idx = findAnchoredIndex(nodes, previousHead);
      if (idx > 0) setFirstItemIndex((v) => v - idx);
    }
    prevHeadNode.current = headNode;
  }, [nodes, workspaceId]);

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
        atTopStateChange={setAtTop}
        atBottomStateChange={setAtBottom}
        firstItemIndex={firstItemIndex}
        initialTopMostItemIndex={Math.max(0, nodes.length - 1)}
        {...(hasOlder && onReachedTop ? { startReached: onReachedTop } : {})}
        computeItemKey={(_i, node) => keyOf(node)}
        itemContent={(_i, node) => (
          <Row node={node} workspaceId={workspaceId} onPreviewImage={onPreviewImage} />
        )}
        components={{
          Footer: () => (
            <div style={{ padding: '0 24px 12px' }}>
              {streamingText ? (
                <StreamingAssistant text={streamingText} />
              ) : streamingReasoning ? (
                <StreamingReasoning text={streamingReasoning} />
              ) : sending ? (
                <ThinkingIndicator />
              ) : null}
            </div>
          ),
        }}
      />
      <JumpToLatest visible={!atBottom} unread={newBelow} onJump={jumpToLatest} />
    </div>
  );
}
