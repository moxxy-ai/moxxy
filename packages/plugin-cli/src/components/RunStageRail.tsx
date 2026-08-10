import React, { useEffect, useState } from 'react';
import { Box, Text } from 'ink';
import type { MoxxyEvent } from '@moxxy/sdk';
import { Colors, Glyphs } from '../theme.js';

export type RunStage = 'understand' | 'act' | 'verify';

const STAGES: ReadonlyArray<{ readonly id: RunStage; readonly full: string; readonly short: string }> = [
  { id: 'understand', full: 'UNDERSTAND', short: 'UND' },
  { id: 'act', full: 'ACT', short: 'ACT' },
  { id: 'verify', full: 'VERIFY', short: 'VER' },
];

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

export const RunStageRail: React.FC<{ readonly stage: RunStage; readonly inset?: boolean }> = ({
  stage,
  inset = false,
}) => {
  const columns = useTerminalColumns();
  const compact = columns < 64;
  const activeIndex = STAGES.findIndex((entry) => entry.id === stage);

  return (
    <Box width="100%" marginTop={inset ? 0 : 1} paddingX={1}>
      <Text dimColor>{compact ? '' : 'RUN  '}</Text>
      {STAGES.map((entry, index) => {
        const active = index === activeIndex;
        const complete = index < activeIndex;
        const glyph = active || complete ? Glyphs.filled : Glyphs.pending;
        return (
          <React.Fragment key={entry.id}>
            {index > 0 ? <Text dimColor>{compact ? '  ' : '  ─  '}</Text> : null}
            <Text
              color={active ? Colors.busy : complete ? Colors.active : undefined}
              dimColor={!active && !complete}
              bold={active}
            >
              {`${glyph} 0${index + 1} ${compact ? entry.short : entry.full}`}
            </Text>
          </React.Fragment>
        );
      })}
    </Box>
  );
};

function useTerminalColumns(): number {
  const [columns, setColumns] = useState(() => process.stdout.columns ?? 80);
  useEffect(() => {
    const onResize = (): void => setColumns(process.stdout.columns ?? 80);
    process.stdout.on('resize', onResize);
    return () => {
      process.stdout.off('resize', onResize);
    };
  }, []);
  return columns;
}
