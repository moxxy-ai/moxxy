import React, { useMemo, useRef } from 'react';
import { Box, Static } from 'ink';
import type { MoxxyEvent } from '@moxxy/sdk';
import { BlockLine } from './chat/BlockLine.js';
import { IncrementalFold, isSettled, pairToolEvents, type Block, type CompactToolMap } from '@moxxy/chat-model';
import { StreamingPreview, tailForViewport } from './chat/StreamingPreview.js';

export interface ChatViewProps {
  readonly events: ReadonlyArray<MoxxyEvent>;
  readonly streamingDelta?: string;
  /** Live (un-persisted) thinking stream; shown dim when no assistant text yet. */
  readonly reasoningDelta?: string;
  /** Global Ctrl+O toggle — expand every live-tools block at once. */
  readonly expandToolOutputs?: boolean;
  /** Per-tool compact-presentation metadata from the active tool registry. */
  readonly compactTools?: CompactToolMap;
  /**
   * Suppress the dynamic area (live blocks + streaming preview) while a
   * modal overlay is on screen. The Static, already-flushed scrollback
   * stays intact — only the still-mutating tail vanishes so the modal
   * doesn't push the combined live height past the terminal rows
   * (which is what triggers Ink's fallback "append every frame" mode
   * and leaves "shadow text" once the modal dismisses).
   */
  readonly hideLive?: boolean;
}

/**
 * Renders the chat scrollback. Pairs `tool_call_requested` events with
 * their matching `tool_result` / `tool_call_denied` so each tool use
 * shows as a single block:
 *
 *   ● Tool(arg=value, arg=value)
 *     └ result summary OR error reason
 *
 * Matches the visual rhythm of Claude Code's tool-use rendering.
 */
export const ChatView: React.FC<ChatViewProps> = ({
  events,
  streamingDelta,
  reasoningDelta,
  expandToolOutputs,
  compactTools,
  hideLive,
}) => {
  // The fold is INCREMENTAL: an IncrementalFold keeps the folded block tree
  // alive across renders and re-folds only the tail past its high-water mark
  // (the old pairToolEvents walked the whole array from index 0 on every
  // committed event — O(n²) over a turn). `syncTo` extends the prefix when
  // `events` is a pure append (the live case) and rebuilds from scratch only
  // when the prefix shifts (/clear, /new) or `compactTools` changes (a new
  // tool registry → a different fold). Memoized on the events reference so an
  // unrelated re-render (mcp poll, streaming tick) re-runs nothing: setEvents
  // makes a new array only when a non-chunk event lands.
  const foldRef = useRef<IncrementalFold | null>(null);
  const compactRef = useRef<CompactToolMap | undefined>(undefined);
  const blocks = useMemo(() => {
    // Degrade to the (byte-identical) full fold if IncrementalFold is somehow
    // unavailable — the optimization is a pure perf seam, never a behaviour change.
    if (typeof IncrementalFold !== 'function') return pairToolEvents(events, compactTools);
    if (!foldRef.current || compactRef.current !== compactTools) {
      foldRef.current = new IncrementalFold(compactTools);
      compactRef.current = compactTools;
    }
    // syncTo returns the (stable) root, re-folding only the unsettled tail.
    // Slice once so React/Static see a fresh array per committed change while
    // the fold itself keeps mutating its own in-place tree across ticks.
    return foldRef.current.syncTo(events).slice();
  }, [events, compactTools]);
  // The longest leading prefix of blocks whose contents will never
  // change again gets handed to <Static>. Ink renders each Static item
  // ONCE, appends it to the terminal scrollback, then skips it on every
  // subsequent frame — so the "live" area below stays small. That
  // matters because Ink's renderer takes a `clearTerminal` shortcut
  // whenever `outputHeight >= terminal rows`, and clearing+repainting
  // the whole screen at spinner/streaming-chunk rate is exactly the
  // multi-times-per-second "flashing" the user sees during tool calls.
  //
  // settledRef is append-only on purpose: Static caches by index, so
  // any previously-handed item is frozen. We only push blocks once
  // they're truly settled (tool call has an outcome, skill scope is
  // closed with all children settled, subagent has completed, etc.).
  const settledRef = useRef<Block[]>([]);
  const clearGenerationRef = useRef(0);
  // /clear and /new drop events back to []. settledRef still holds old
  // captures — detect the shrink, drop them, and bump a key so the
  // Static node fully remounts (its internal `index` resets).
  if (blocks.length < settledRef.current.length) {
    settledRef.current = [];
    clearGenerationRef.current += 1;
  }
  // The settled prefix only ever GROWS (settledRef is append-only; a settled
  // block never un-settles), so resume the scan at the known high-water mark
  // instead of re-walking the whole list from index 0 each render. The shrink
  // case above resets the mark to 0, so this is always safe.
  let settledCount = settledRef.current.length;
  for (let i = settledRef.current.length; i < blocks.length; i += 1) {
    if (isSettled(blocks[i]!)) settledCount += 1;
    else break;
  }
  if (settledCount > settledRef.current.length) {
    const next = settledRef.current.slice();
    for (let i = settledRef.current.length; i < settledCount; i += 1) {
      next.push(blocks[i]!);
    }
    settledRef.current = next;
  }
  const liveBlocks = blocks.slice(settledRef.current.length);
  return (
    <>
      <Static key={clearGenerationRef.current} items={settledRef.current}>
        {(block) => (
          <BlockLine
            key={block.id}
            block={block}
            expandToolOutputs={!!expandToolOutputs}
          />
        )}
      </Static>
      {hideLive ? null : (
        <Box flexDirection="column">
          {liveBlocks.map((b) => (
            <BlockLine
              key={b.id}
              block={b}
              expandToolOutputs={!!expandToolOutputs}
            />
          ))}
          {streamingDelta && streamingDelta.trim() ? (
            <StreamingPreview content={tailForViewport(streamingDelta)} />
          ) : reasoningDelta && reasoningDelta.trim() ? (
            // Dim live-thinking preview, only while there's no assistant text
            // yet. Prefix lands on the same single visual row as the content
            // tail, preserving StreamingPreview's no-stacking invariant.
            <StreamingPreview content={`thinking · ${tailForViewport(reasoningDelta)}`} dim />
          ) : null}
        </Box>
      )}
    </>
  );
};
