import React from 'react';
import { Box, Text } from 'ink';
import { stepListOf, type StepListBlock } from '@moxxy/chat-model';
import { stepListProgress, type StepListDisplay, type StepStatus } from '@moxxy/sdk';
import { blockGap } from './density.js';
import { ActivityDot } from './ActivityDot.js';
import { Colors } from '../../theme.js';

const MARKS: Record<StepStatus, string> = {
  completed: '✓',
  in_progress: '●',
  pending: '○',
  cancelled: '✗',
};

/** The heading of an agent's list of steps: "Steps · 1 of 3 done". */
export function stepListHeading(display: StepListDisplay): string {
  const { done, total } = stepListProgress(display);
  return `Steps · ${done} of ${total} done`;
}

/** One line per step, its state as a mark that reads without color. */
export function stepListLines(display: StepListDisplay): ReadonlyArray<{ readonly mark: string; readonly text: string; readonly status: StepStatus }> {
  return display.steps.map((step) => ({ mark: MARKS[step.status], text: step.text, status: step.status }));
}

/** An agent's list of steps, one per turn, updated in place as it works. */
export const StepListView: React.FC<{ readonly block: StepListBlock }> = ({ block }) => {
  const display = stepListOf(block);
  if (!display) return null;
  const { done, total } = stepListProgress(display);
  return (
    <Box flexDirection="column" marginTop={blockGap()}>
      <Box>
        <ActivityDot state={done === total ? 'success' : block.closed ? 'neutral' : 'active'} />
        <Text>{` ${stepListHeading(display)}`}</Text>
      </Box>
      {display.explanation ? (
        <Box marginLeft={2}>
          <Text dimColor>{display.explanation}</Text>
        </Box>
      ) : null}
      {stepListLines(display).map((line, i) => (
        <Box key={i} marginLeft={2}>
          <Text color={line.status === 'completed' ? Colors.active : undefined} dimColor={line.status === 'pending' || line.status === 'cancelled'}>
            {line.mark}
          </Text>
          <Text dimColor={line.status === 'cancelled'} strikethrough={line.status === 'cancelled'} bold={line.status === 'in_progress'}>
            {` ${line.text}`}
          </Text>
        </Box>
      ))}
    </Box>
  );
};
