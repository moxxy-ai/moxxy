import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Virtuoso, type VirtuosoHandle } from 'react-virtuoso';
import type { MoxxyEvent } from '@moxxy/sdk';
import {
  blocksEquivalent,
  IncrementalFold,
  type Block as FoldedBlock,
  type CompactToolMap,
} from '@moxxy/chat-model';
import { buildRenderNodes, keyOfNode, type Extension, type RenderNode } from '@moxxy/client-core';
import { BlockView, StreamingAssistant } from './BlockView';
import { AttachmentReaderProvider } from './attachments/AttachmentReaderContext';
import { ToolIconProvider } from './ToolIconContext';
import { ImagePreviewProvider } from './image-preview/ImagePreviewContext';
import { ToolGroupView } from './ToolGroupView';
import { ExtensionCard } from './ExtensionCard';
import { ThinkingIndicator } from './ThinkingIndicator';
import { StreamingReasoning } from './blocks/StreamingReasoning';
import { ThinkingGroupView } from './blocks/ReasoningBlock';
import { TraceEntry } from './trace/TraceEntry';
import { JumpToLatest, useNewContentBelow } from './JumpToLatest';
import type { ImagePreviewItem } from './image-preview/types';
import { transcriptNodes } from './transcript-nodes';
import { WorkGroupView } from './WorkGroupView';
import { ModeTranscriptContext } from './modes/ModeTranscriptContext';
import { PlanNextContext, type AnswerPlan } from './modes/plan-next';
import { readModeEvents } from './modes/mode-events';

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
  /** Presentation metadata advertised by the live tool registry. */
  readonly compactTools?: CompactToolMap;
  /** Carries the open plan out; null or absent where that is not on offer. */
  readonly onPlanNext?: AnswerPlan | null;
}

/** Memoised per-block so a streaming chunk (which only changes
 *  `streamingText`) doesn't repaint settled rows. */
const MemoBlock = memo(
  function MemoBlock({
    block,
    onPreviewImage,
    foldVersion: _foldVersion,
  }: {
    readonly block: FoldedBlock;
    readonly onPreviewImage?: (image: ImagePreviewItem) => void;
    /** Mutable incremental-fold blocks need a scalar revision so memo sees
     *  outcome/scope changes even when the object reference is stable. */
    readonly foldVersion: number;
  }): JSX.Element | null {
    return <BlockView block={block} onPreviewImage={onPreviewImage} />;
  },
  (a, b) =>
    a.foldVersion === b.foldVersion &&
    blocksEquivalent(a.block, b.block) &&
    a.onPreviewImage === b.onPreviewImage,
);

const keyOf = keyOfNode;

/** A row a group can grow over as older history pages in: a tool, a thought, or a turn's work. */
function toolAnchorId(node: RenderNode): string | null {
  if (node.kind === 'work') {
    const last = node.nodes.at(-1);
    return last ? toolAnchorId(last) : null;
  }
  if (node.kind === 'tool-group') return node.tools.at(-1)?.id ?? null;
  if (node.kind === 'thinking') return node.events.at(-1)?.id ?? null;
  if (node.kind === 'block' && (node.block.kind === 'tool-call' || node.block.kind === 'event')) return node.block.id;
  return null;
}

function containsToolAnchor(node: RenderNode, anchorId: string): boolean {
  if (node.kind === 'work') return node.nodes.some((inner) => containsToolAnchor(inner, anchorId));
  if (node.kind === 'tool-group') return node.tools.some((tool) => tool.id === anchorId);
  if (node.kind === 'thinking') return node.events.some((event) => event.id === anchorId);
  return node.kind === 'block' && node.block.id === anchorId;
}

function findAnchoredIndex(nodes: ReadonlyArray<RenderNode>, previousHead: RenderNode): number {
  const previousKey = keyOf(previousHead);
  const exact = nodes.findIndex((node) => keyOf(node) === previousKey);
  if (exact >= 0) return exact;

  const anchorId = toolAnchorId(previousHead);
  if (!anchorId) return -1;
  return nodes.findIndex((node) => containsToolAnchor(node, anchorId));
}

interface RowProps {
  readonly node: RenderNode;
  readonly workspaceId?: string;
  readonly onPreviewImage?: (image: ImagePreviewItem) => void;
  readonly foldVersion: number;
}

function Row(props: RowProps): JSX.Element {
  return (
    <div className="transcript__row">
      <NodeView {...props} />
    </div>
  );
}

function NodeView({ node, workspaceId, onPreviewImage, foldVersion }: RowProps): JSX.Element {
  return (
    <>
      {node.kind === 'ext' ? (
        <ExtensionCard ext={node.ext} workspaceId={workspaceId} />
      ) : node.kind === 'work' ? (
        <WorkGroupView group={node}>
          {node.nodes.map((inner) => (
            <div key={keyOf(inner)} className="work-group__step">
              <NodeView node={inner} workspaceId={workspaceId} onPreviewImage={onPreviewImage} foldVersion={foldVersion} />
            </div>
          ))}
        </WorkGroupView>
      ) : node.kind === 'tool-group' ? (
        <ToolGroupView tools={node.tools} />
      ) : node.kind === 'thinking' ? (
        <TraceEntry kind="reasoning">
          <ThinkingGroupView events={node.events} />
        </TraceEntry>
      ) : (
        <MemoBlock
          block={node.block}
          onPreviewImage={onPreviewImage}
          foldVersion={foldVersion}
        />
      )}
    </>
  );
}

/** Room above the first entry. A list header, because the scroller itself is
 *  measured by Virtuoso and cannot take padding. */
function TranscriptLead(): JSX.Element {
  return <div className="transcript__lead" aria-hidden />;
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
  compactTools,
  onPlanNext = null,
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
  const compactRef = useRef<CompactToolMap | undefined>(undefined);
  if (
    typeof IncrementalFold === 'function' &&
    (foldRef.current === null || compactRef.current !== compactTools)
  ) {
    foldRef.current = new IncrementalFold(compactTools);
    compactRef.current = compactTools;
  }
  // What the plan, goal and research modes reported about these turns.
  const modes = useMemo(() => readModeEvents(events), [events]);
  // The turn still going stays unfolded; once it ends, its work folds under the answer.
  const running = sending === true;
  const nodes = useMemo(
    () => transcriptNodes(
      buildRenderNodes(events, extensions, foldRef.current ?? undefined, compactTools),
      modes,
      running,
    ),
    [events, extensions, compactTools, modes, running],
  );
  const foldVersion = foldRef.current?.version ?? events.length;

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
    // One catalog fetch for the whole transcript; every tool row reads the
    // declared icon from context rather than asking for it per row.
    <ModeTranscriptContext.Provider value={modes}>
    <PlanNextContext.Provider value={onPlanNext}>
    <ToolIconProvider workspaceId={workspaceId}>
    <ImagePreviewProvider value={onPreviewImage ?? null}>
    <AttachmentReaderProvider workspaceId={workspaceId}>
    {/* Relative wrapper so the jump-to-latest button can float over the
        scroller without joining the virtualised content. */}
    <div className="transcript">
      <Virtuoso<RenderNode>
        ref={virtuosoRef}
        data={nodes as RenderNode[]}
        data-testid="transcript"
        className="transcript__scroller"
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
          <Row
            node={node}
            workspaceId={workspaceId}
            onPreviewImage={onPreviewImage}
            foldVersion={foldVersion}
          />
        )}
        components={{
          Header: TranscriptLead,
          Footer: () => (
            <div className="transcript__row transcript__tail">
              {streamingText ? (
                <TraceEntry kind="agent">
                  <StreamingAssistant text={streamingText} />
                </TraceEntry>
              ) : streamingReasoning ? (
                <TraceEntry kind="reasoning">
                  <StreamingReasoning text={streamingReasoning} />
                </TraceEntry>
              ) : sending ? (
                <TraceEntry kind="agent">
                  <ThinkingIndicator />
                </TraceEntry>
              ) : null}
            </div>
          ),
        }}
      />
      <JumpToLatest visible={!atBottom} unread={newBelow} onJump={jumpToLatest} />
    </div>
    </AttachmentReaderProvider>
    </ImagePreviewProvider>
    </ToolIconProvider>
    </PlanNextContext.Provider>
    </ModeTranscriptContext.Provider>
  );
}
