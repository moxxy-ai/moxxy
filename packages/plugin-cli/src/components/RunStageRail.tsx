import React from 'react';
import { Box, Text } from 'ink';
import type { MoxxyEvent } from '@moxxy/sdk';
import { Colors, Glyphs } from '../theme.js';

export type RunStage = 'understand' | 'act' | 'verify';

const STAGE_COPY: Readonly<Record<RunStage, { readonly label: string; readonly detail: string }>> = {
  understand: { label: 'Understanding', detail: 'reading the workspace' },
  act: { label: 'Acting', detail: 'changes stay reviewable' },
  verify: { label: 'Verifying', detail: 'checking the result' },
};

const READ_ONLY_TOOLS = new Set(['Read', 'Glob', 'Grep', 'recall', 'session_recall']);

/**
 * Project the current run onto the three product stages shown in the TUI.
 * This is deliberately a fold over real session events: safe exploration is
 * Understand, a consequential tool request is Act, and its outcome (or a
 * completed answer that needed no action) is Verify.
 */
export function deriveRunStage(
  events: ReadonlyArray<MoxxyEvent>,
  busy: boolean,
  decisionPending: boolean,
): RunStage {
  if (decisionPending) return 'act';

  let promptIndex = -1;
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (!event) continue;
    if (event.type === 'user_prompt' && event.origin?.kind !== 'checkpoint') {
      promptIndex = index;
      break;
    }
  }
  if (promptIndex < 0) return 'understand';

  const prompt = events[promptIndex];
  if (!prompt) return 'understand';
  let latestActionCallId: string | null = null;
  let latestActionIndex = -1;
  let answerCompleted = false;

  for (let index = promptIndex + 1; index < events.length; index += 1) {
    const event = events[index];
    if (!event) continue;
    if (event.turnId !== prompt.turnId) continue;
    if (event.type === 'tool_call_requested' && !READ_ONLY_TOOLS.has(event.name)) {
      latestActionCallId = event.callId;
      latestActionIndex = index;
    }
    if (event.type === 'assistant_message' && event.stopReason === 'end_turn') {
      answerCompleted = true;
    }
  }

  if (latestActionCallId) {
    for (let index = latestActionIndex + 1; index < events.length; index += 1) {
      const event = events[index];
      if (!event) continue;
      if (event.turnId !== prompt.turnId) continue;
      if (
        (event.type === 'tool_result' || event.type === 'tool_call_denied') &&
        event.callId === latestActionCallId
      ) {
        return 'verify';
      }
    }
    return 'act';
  }

  return !busy && answerCompleted ? 'verify' : 'understand';
}

export const RunStageStatus: React.FC<{ readonly stage: RunStage; readonly inset?: boolean }> = ({
  stage,
  inset = false,
}) => {
  const copy = STAGE_COPY[stage];

  return (
    <Box width="100%" marginTop={inset ? 0 : 1} paddingX={1}>
      <Text color={Colors.busy}>{Glyphs.filled}</Text>
      <Text color={Colors.busy} bold>{` ${copy.label}`}</Text>
      <Text dimColor>{` · ${copy.detail}`}</Text>
    </Box>
  );
};
