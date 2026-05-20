import React, { useMemo, useRef } from 'react';
import { Box, Static } from 'ink';
import type { MoxxyEvent } from '@moxxy/sdk';
import { BlockLine } from './chat/BlockLine.js';
import { isSettled, pairToolEvents, type CompactToolMap } from './chat/pair-events.js';
import { StreamingPreview, tailForViewport } from './chat/StreamingPreview.js';
import type { Block } from './chat/types.js';

export interface ChatViewProps {
  readonly events: ReadonlyArray<MoxxyEvent>;
  readonly streamingDelta?: string;
  /** Global Ctrl+O toggle — expand every live-tools block at once. */
  readonly expandToolOutputs?: boolean;
  /** Per-tool compact-presentation metadata from the active tool registry. */
  readonly compactTools?: CompactToolMap;
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
  expandToolOutputs,
  compactTools,
}) => {
  // pairToolEvents walks the whole events array. Parent re-renders
  // happen for unrelated state too (mcp-status poll, every streaming
  // delta tick, etc.), so memoize on the events reference — when a
  // chunk arrives setEvents creates a new array; everything else
  // keeps the old reference and we skip the walk entirely.
  const blocks = useMemo(
    () => pairToolEvents(events, compactTools),
    [events, compactTools],
  );
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
  let settledCount = 0;
  for (const b of blocks) {
    if (isSettled(b)) settledCount += 1;
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
        ) : null}
      </Box>
    </>
  );
};
