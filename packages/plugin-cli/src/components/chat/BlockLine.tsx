import React, { memo } from 'react';
import { Box, Text } from 'ink';
import { blockGap } from './density.js';
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
  /** Incremental-fold revision. Mutable block objects need this explicit
   *  signal so React.memo observes outcome/scope changes. */
  readonly renderVersion: number;
  /** Child of a skill/activity group: use a compact branch guide and no blank row. */
  readonly nested?: boolean;
  /** Width available to viewport-level transcript chrome such as user prompts. */
  readonly availableWidth?: number;
}

export const BlockLine: React.FC<BlockLineProps> = memo(
  function BlockLine({
    block,
    expandToolOutputs,
    renderVersion,
    nested = false,
    availableWidth,
  }) {
    if (block.kind === 'event')
      return (
        <EventLine
          event={block.event}
          expandToolOutputs={expandToolOutputs}
          availableWidth={availableWidth}
        />
      );
    if (block.kind === 'tool-call') {
      return (
        <ToolCallBlock
          request={block.request}
          outcome={block.outcome}
          expanded={expandToolOutputs}
          nested={nested}
        />
      );
    }
    if (block.kind === 'subagent-group') {
      return <SubagentGroupView group={block} expandToolOutputs={expandToolOutputs} />;
    }
    if (block.kind === 'subagent') {
      return <SubagentScopeView scope={block} />;
    }
    if (block.kind === 'live-tools') {
      return <LiveToolBlock block={block} expanded={expandToolOutputs} nested={nested} />;
    }
    if (block.kind === 'collab') {
      return <CollabScopeView scope={block} />;
    }
    return (
      <SkillScopeView
        scope={block}
        expandToolOutputs={expandToolOutputs}
        renderVersion={renderVersion}
      />
    );
  },
  // Blocks are mutated in-place by `pairToolEvents` (tool outcome
  // arrives, scope closes, subagent counter ticks). Compare the
  // render-relevant fields so an unrelated parent re-render (a
  // streaming-delta flush, an mcp poll) doesn't redraw every block.
  (prev, next) => {
    if (prev.expandToolOutputs !== next.expandToolOutputs) return false;
    if (prev.nested !== next.nested) return false;
    if (prev.availableWidth !== next.availableWidth) return false;
    if (prev.renderVersion !== next.renderVersion) return false;
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
  renderVersion: number;
}> = ({ scope, expandToolOutputs, renderVersion }) => {
  const childToolCount = countToolCalls(scope.children);
  const runningTools = scope.children.some(hasRunningTool);
  const presentation = skillActivityPresentation(
    scope,
    childToolCount,
    scope.loading || !scope.closed || runningTools,
  );
  const hasDetails = childToolCount > 0;
  const showChildren = hasDetails && (!scope.closed || runningTools || expandToolOutputs);
  const marker = presentation.active ? '◇' : hasDetails ? (showChildren ? '▾' : '▸') : '•';
  const activityText = `${presentation.active ? 'Using' : 'Used'} ${presentation.label}`;
  return (
    <Box flexDirection="column" marginTop={blockGap()}>
      <Box>
        <Text dimColor>{`${marker} `}</Text>
        <ShimmerText text={activityText} active={presentation.active} />
        {presentation.meta ? <Text dimColor>{` · ${presentation.meta}`}</Text> : null}
        {scope.closed && hasDetails ? (
          <Text dimColor>{`  ·  Ctrl+O ${showChildren ? 'collapse' : 'details'}`}</Text>
        ) : null}
      </Box>
      {showChildren ? (
        <Box flexDirection="column" marginLeft={2}>
          {scope.children.map((c) => (
            <BlockLine
              key={c.id}
              block={c}
              expandToolOutputs={expandToolOutputs}
              renderVersion={renderVersion}
              nested
            />
          ))}
        </Box>
      ) : null}
    </Box>
  );
};

export function skillActivityPresentation(
  scope: SkillScopeBlock,
  childToolCount = countToolCalls(scope.children),
  active = scope.loading,
): { readonly label: string; readonly meta: string | null; readonly active: boolean } {
  const name = truncate(scope.skillEvent.name, NAME_DISPLAY_MAX);
  const meta = childToolCount > 0
    ? `${childToolCount} tool${childToolCount === 1 ? '' : 's'}`
    : null;
  return { label: name, meta, active };
}

function hasRunningTool(block: Block): boolean {
  if (block.kind === 'tool-call') return block.outcome === null;
  if (block.kind === 'live-tools') return block.calls.some((call) => call.outcome === null);
  if (block.kind === 'skill-scope') return block.children.some(hasRunningTool);
  return false;
}
