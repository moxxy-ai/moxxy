import React, { memo } from 'react';
import { Box, Text } from 'ink';
import { EventLine } from './EventLine.js';
import { LiveToolBlock } from './LiveToolBlock.js';
import { ToolCallBlock } from './ToolCallBlock.js';
import { SubagentScopeView } from './SubagentScopeView.js';
import { SubagentGroupView } from './SubagentGroupView.js';
import { CollabScopeView } from './CollabScopeView.js';
import { ShimmerText } from './ShimmerText.js';
import {
  blocksEquivalent,
  countToolCalls,
  truncate,
  type Block,
  type SkillScopeBlock,
} from '@moxxy/chat-model';

const NAME_DISPLAY_MAX = 48;

export interface BlockLineProps {
  readonly block: Block;
  /** Global Ctrl+O toggle. Expands every live-tools block at once. */
  readonly expandToolOutputs: boolean;
}

export const BlockLine: React.FC<BlockLineProps> = memo(
  function BlockLine({ block, expandToolOutputs }) {
    if (block.kind === 'event')
      return <EventLine event={block.event} expandToolOutputs={expandToolOutputs} />;
    if (block.kind === 'tool-call') {
      return (
        <ToolCallBlock request={block.request} outcome={block.outcome} expanded={expandToolOutputs} />
      );
    }
    if (block.kind === 'subagent-group') {
      return <SubagentGroupView group={block} expandToolOutputs={expandToolOutputs} />;
    }
    if (block.kind === 'subagent') {
      return <SubagentScopeView scope={block} />;
    }
    if (block.kind === 'live-tools') {
      return <LiveToolBlock block={block} expanded={expandToolOutputs} />;
    }
    if (block.kind === 'collab') {
      return <CollabScopeView scope={block} />;
    }
    return <SkillScopeView scope={block} expandToolOutputs={expandToolOutputs} />;
  },
  // Blocks are mutated in-place by `pairToolEvents` (tool outcome
  // arrives, scope closes, subagent counter ticks). Compare the
  // render-relevant fields so an unrelated parent re-render (a
  // streaming-delta flush, an mcp poll) doesn't redraw every block.
  (prev, next) => {
    if (prev.expandToolOutputs !== next.expandToolOutputs) return false;
    return blocksEquivalent(prev.block, next.block);
  },
);

/**
 * Active skills stay expanded so their work is visible. Once settled they
 * collapse to one transcript-style row and follow the global Ctrl+O toggle.
 */
const SkillScopeView: React.FC<{
  scope: SkillScopeBlock;
  expandToolOutputs: boolean;
}> = ({ scope, expandToolOutputs }) => {
  const childToolCount = countToolCalls(scope.children);
  const nameLabel = truncate(scope.skillEvent.name, NAME_DISPLAY_MAX);
  const callLabel = `${childToolCount} tool call${childToolCount === 1 ? '' : 's'}`;
  const active = !scope.closed || scope.children.some(hasRunningTool);
  const showChildren = active || expandToolOutputs;
  const label = `${active ? 'Using' : 'Used'} skill ${nameLabel}${active ? '…' : ''}`;
  return (
    <Box flexDirection="column" marginTop={1}>
      <Box>
        <Text dimColor>✦ </Text>
        <ShimmerText text={label} active={active} />
        <Text dimColor>{` · ${callLabel}${showChildren ? '' : '  ›'}`}</Text>
      </Box>
      {showChildren ? (
        <Box flexDirection="column" marginLeft={2}>
          {scope.children.map((c) => (
            <BlockLine key={c.id} block={c} expandToolOutputs={expandToolOutputs} />
          ))}
        </Box>
      ) : null}
    </Box>
  );
};

function hasRunningTool(block: Block): boolean {
  if (block.kind === 'tool-call') return block.outcome === null;
  if (block.kind === 'live-tools') return block.calls.some((call) => call.outcome === null);
  if (block.kind === 'skill-scope') return block.children.some(hasRunningTool);
  return false;
}
