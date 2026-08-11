import React from 'react';
import { Box, Text } from 'ink';
import type { MoxxyEvent, TriggerOrigin } from '@moxxy/sdk';
import { Colors, Glyphs } from '../../theme.js';
import { wrapLogicalLine } from '../prompt/BufferLines.js';
import { blockGap } from './density.js';
import { AssistantBlock } from './AssistantBlock.js';
import { ActivityDot } from './ActivityDot.js';

export const EventLine: React.FC<{
  event: MoxxyEvent;
  expandToolOutputs?: boolean;
  availableWidth?: number;
}> = ({ event, expandToolOutputs, availableWidth }) => {
  switch (event.type) {
    case 'user_prompt': {
      if (event.origin) {
        return (
          <Box flexDirection="column" marginTop={blockGap()}>
            <Box>
              <Text dimColor>{`${Glyphs.filled} ${formatTriggerOrigin(event.origin)} · `}</Text>
              <Text>{event.origin.name}</Text>
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
      // Keep authored prompts visually distinct from agent output without
      // reintroducing YOU/MOXXY labels. The prompt is terminal chrome rather
      // than prose, so its band spans the viewport while answers retain their
      // narrower reading column.
      const promptWidth = Math.max(24, availableWidth ?? (process.stdout.columns ?? 80) - 1);
      const blankPromptRow = ' '.repeat(promptWidth);
      const promptRows = formatUserPromptRows(event.text, promptWidth);
      return (
        <Box flexDirection="column" marginTop={blockGap()}>
          <Text bold color="white" backgroundColor={Colors.chrome}>
            {[blankPromptRow, ...promptRows, blankPromptRow].join('\n')}
          </Text>
        </Box>
      );
    }
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
          <Box flexDirection="column" marginTop={blockGap()} paddingLeft={2}>
            <Text dimColor>▾ Thinking</Text>
            <Box marginLeft={2}>
              <Text dimColor>{content}</Text>
            </Box>
          </Box>
        );
      }
      return (
        <Box marginTop={blockGap()} paddingLeft={2}>
          <Text dimColor>▸ Thinking</Text>
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
          <ActivityDot state="success" />
          <Text> </Text>
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
          <ActivityDot state="error" />
          <Text> </Text>
          <Text color={Colors.danger}>error: </Text>
          <Text>{event.message}</Text>
        </Box>
      );
    case 'abort':
      return (
        <Box marginTop={blockGap()}>
          <ActivityDot state="error" />
          <Text color={Colors.danger}> aborted: {event.reason}</Text>
        </Box>
      );
    default:
      return null;
  }
};

export function formatUserPromptRows(text: string, width: number): ReadonlyArray<string> {
  const rowWidth = Math.max(8, width);
  const contentWidth = Math.max(1, rowWidth - 4); // two-column horizontal padding
  const visualRows = text.trim().split('\n').flatMap((line) => wrapLogicalLine(line, contentWidth));
  return visualRows.map((row) => {
    const content = row.text.trimEnd();
    const prefix = '  ';
    return `${prefix}${content}${' '.repeat(Math.max(2, rowWidth - prefix.length - content.length))}`;
  });
}

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
