import React from 'react';
import { Box, Text } from 'ink';
import type { MoxxyEvent, TriggerOrigin } from '@moxxy/sdk';
import { Colors, Glyphs } from '../../theme.js';
import { blockGap } from './density.js';
import { AssistantBlock } from './AssistantBlock.js';

export const EventLine: React.FC<{ event: MoxxyEvent; expandToolOutputs?: boolean }> = ({
  event,
  expandToolOutputs,
}) => {
  switch (event.type) {
    case 'user_prompt':
      if (event.origin) {
        return (
          <Box flexDirection="column" marginTop={blockGap()}>
            <Box>
              <Text dimColor>{`${Glyphs.filled} ${formatTriggerOrigin(event.origin)} · `}</Text>
              <Text>{event.origin.name}</Text>
              {!expandToolOutputs ? <Text dimColor>{'  ·  Ctrl+O details'}</Text> : null}
            </Box>
            {expandToolOutputs ? (
              <Box marginLeft={2}>
                <Text dimColor>{event.text}</Text>
              </Box>
            ) : null}
          </Box>
        );
      }
      // System-injected context notes (e.g. the /vault reference) aren't user
      // input — render them as a compact dim note rather than the bold pinned
      // bar, so they don't dominate the transcript.
      if (event.source && event.source !== 'user') {
        return (
          <Box marginTop={blockGap()}>
            <Text dimColor>{`${Glyphs.midDot} ${event.text}`}</Text>
          </Box>
        );
      }
      // Editorial transcript treatment: a quiet speaker label and the exact
      // prompt below it. No underline/rule — long prompts should wrap like
      // prose, not look like a selected terminal command.
      return (
        <Box flexDirection="column" marginTop={blockGap()} paddingX={1}>
          <Text dimColor bold>YOU</Text>
          <Box marginLeft={1}>
            <Text bold>{event.text.trim()}</Text>
          </Box>
        </Box>
      );
    case 'assistant_message':
      return <AssistantBlock content={event.content} />;
    case 'reasoning_message': {
      // Redacted/encrypted thinking is display-suppressed and can never be
      // expanded — show a static withheld marker.
      if (event.redacted) {
        return (
          <Box marginTop={blockGap()}>
            <Text dimColor>{'◇ Thinking · details withheld'}</Text>
          </Box>
        );
      }
      const content = event.content ?? '';
      // Collapsed (default): one dim line — the diamond + first content line.
      // Ctrl+O (the global expandToolOutputs toggle) reveals the full text,
      // since Ink has no native collapse affordance.
      if (expandToolOutputs) {
        return (
          <Box flexDirection="column" marginTop={blockGap()}>
            <Text dimColor>{'▾ Thinking  ·  Ctrl+O collapse'}</Text>
            <Box marginLeft={2}>
              <Text dimColor>{content}</Text>
            </Box>
          </Box>
        );
      }
      return (
        <Box marginTop={blockGap()}>
          <Text dimColor>{'▸ Thinking  ·  Ctrl+O details'}</Text>
        </Box>
      );
    }
    case 'skill_invoked':
      // SkillScopeView owns this render; if we reach here it means the
      // event escaped grouping (defensive fallback only).
      return null;
    case 'skill_created':
      return (
        <Box marginTop={blockGap()}>
          <Text dimColor>{Glyphs.filled} </Text>
          <Text bold>skill created</Text>
          <Text dimColor>  {event.name}</Text>
        </Box>
      );
    case 'plugin_registered':
      return (
        <Box>
          <Text dimColor>  + plugin: {event.name}@{event.version}</Text>
        </Box>
      );
    case 'compaction':
      return (
        <Box marginTop={blockGap()}>
          <Text dimColor>⤺ </Text>
          <Text dimColor>{formatCompactionEvent(event)}</Text>
        </Box>
      );
    case 'error':
      return (
        <Box marginTop={blockGap()}>
          <Text color={Colors.danger}>{Glyphs.filled} </Text>
          <Text color={Colors.danger}>error: </Text>
          <Text>{event.message}</Text>
        </Box>
      );
    case 'abort':
      return (
        <Box marginTop={blockGap()}>
          <Text color={Colors.busy}>⏹ aborted: {event.reason}</Text>
        </Box>
      );
    default:
      return null;
  }
};

const TRIGGER_VERBS: Record<TriggerOrigin['kind'], string> = {
  webhook: 'Webhook received',
  schedule: 'Schedule fired',
  workflow: 'Workflow ran',
  checkpoint: 'Checkpoint intervened',
};

export function formatTriggerOrigin(origin: TriggerOrigin): string {
  return TRIGGER_VERBS[origin.kind];
}

export function formatCompactionEvent(event: Extract<MoxxyEvent, { type: 'compaction' }>): string {
  if (event.tokensSaved <= 0 || event.summary.trim().length === 0) {
    return 'context checked · nothing to compact';
  }
  const compactedEvents = event.replacedRange[1] - event.replacedRange[0] + 1;
  return `context compacted · ${formatCount(compactedEvents)} ${plural(compactedEvents, 'event')} · ~${formatTokenCount(event.tokensSaved)} tokens saved`;
}

function formatCount(value: number): string {
  return new Intl.NumberFormat('en-US').format(value);
}

function formatTokenCount(value: number): string {
  if (value >= 1_000_000) return `${trimFixed(value / 1_000_000)}M`;
  if (value >= 1_000) return `${trimFixed(value / 1_000)}k`;
  return formatCount(value);
}

function trimFixed(value: number): string {
  return value.toFixed(1).replace(/\.0$/, '');
}

function plural(count: number, noun: string): string {
  return count === 1 ? noun : `${noun}s`;
}
