import React, { memo } from 'react';
import { Box, Text } from 'ink';
import { Glyphs } from '../../theme.js';
import { EventLine } from './EventLine.js';
import { ToolCallBlock } from './ToolCallBlock.js';
import { SubagentScopeView } from './SubagentScopeView.js';
import type { Block, SkillScopeBlock } from './types.js';
import { blocksEquivalent, countToolCalls } from './pair-events.js';
import { DotColors } from './format.js';

export const BlockLine: React.FC<{ block: Block; expandClosedSkills: boolean }> = memo(
  function BlockLine({ block, expandClosedSkills }) {
    if (block.kind === 'event') return <EventLine event={block.event} />;
    if (block.kind === 'tool-call') {
      return <ToolCallBlock request={block.request} outcome={block.outcome} />;
    }
    if (block.kind === 'subagent') {
      return <SubagentScopeView scope={block} />;
    }
    return <SkillScopeView scope={block} expandClosedSkills={expandClosedSkills} />;
  },
  // Blocks are mutated in-place by `pairToolEvents` (tool outcome
  // arrives, scope closes, subagent counter ticks). Compare the
  // render-relevant fields so an unrelated parent re-render (a
  // streaming-delta flush, an mcp poll) doesn't redraw every block.
  (prev, next) => {
    if (prev.expandClosedSkills !== next.expandClosedSkills) return false;
    return blocksEquivalent(prev.block, next.block);
  },
);

const SkillScopeView: React.FC<{ scope: SkillScopeBlock; expandClosedSkills: boolean }> = ({
  scope,
  expandClosedSkills,
}) => {
  const childToolCount = countToolCalls(scope.children);
  const isExpanded = !scope.closed || expandClosedSkills;
  const callLabel = `skill · ${childToolCount} tool call${childToolCount === 1 ? '' : 's'}`;
  return (
    <Box flexDirection="column" marginTop={1}>
      <Box>
        <Text color={DotColors.skill}>{Glyphs.filled} </Text>
        <Text bold>{scope.skillEvent.name}</Text>
        <Text dimColor>{` (${callLabel})`}</Text>
        {scope.closed && !expandClosedSkills ? (
          <Text dimColor italic>{'  collapsed'}</Text>
        ) : null}
      </Box>
      {isExpanded ? (
        <Box flexDirection="column" marginLeft={2}>
          {scope.children.map((c) => (
            <BlockLine key={c.id} block={c} expandClosedSkills={expandClosedSkills} />
          ))}
        </Box>
      ) : null}
    </Box>
  );
};
