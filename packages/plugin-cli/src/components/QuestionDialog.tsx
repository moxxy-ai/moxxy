import React from 'react';
import { Box, Text, useInput } from 'ink';
import type { OpenQuestion } from '@moxxy/sdk';
import { Colors } from '../theme.js';
import { Modal } from './Modal.js';
import { OWN_ANSWER_ROW, questionRows, type FlowKey, type QuestionFlow } from '../session/question-flow.js';

export interface QuestionDialogProps {
  readonly question: OpenQuestion;
  readonly flow: QuestionFlow;
  readonly sending: boolean;
  readonly error: string | null;
  readonly onKey: (key: FlowKey) => void;
}

/**
 * A Question from the agent, one question at a time. It draws the flow and
 * hands every key to it; what a key does lives in `question-flow`.
 */
export const QuestionDialog: React.FC<QuestionDialogProps> = ({ question, flow, sending, error, onKey }) => {
  const item = question.questions[flow.step];
  useInput((input, key) => {
    if (key.upArrow) onKey({ kind: 'up' });
    else if (key.downArrow) onKey({ kind: 'down' });
    else if (key.return) onKey({ kind: 'enter' });
    else if (key.escape) onKey({ kind: 'escape' });
    else if (key.backspace || key.delete || input === '\x7f' || input === '\x08') onKey({ kind: 'backspace' });
    else if (flow.typing !== null && input && !key.ctrl && !key.meta && !key.tab) onKey({ kind: 'text', text: input });
    else if (input === ' ') onKey({ kind: 'space' });
  });
  if (!item) return null;

  const total = question.questions.length;
  const picked = flow.draft[item.id];
  const hints =
    flow.typing !== null
      ? 'Enter answer · Esc back'
      : `↑↓ move · ${item.multiSelect ? 'Space choose · Enter next' : 'Enter choose'}${flow.step > 0 ? ' · Esc previous' : ''}`;
  return (
    <Modal title={total > 1 ? `Question ${flow.step + 1} of ${total}` : 'Question'} hints={hints}>
      <Box flexDirection="column" marginBottom={1}>
        {item.header ? <Text color={Colors.mode}>{item.header}</Text> : null}
        <Text bold>{item.question}</Text>
        {item.multiSelect ? <Text dimColor>Choose any</Text> : null}
      </Box>
      {flow.typing !== null ? (
        <Box>
          <Text>› </Text>
          <Text>{flow.typing}</Text>
          <Text inverse> </Text>
        </Box>
      ) : (
        <Box flexDirection="column">
          {questionRows(item).map((row, i) => {
            const active = i === flow.cursor;
            const chosen =
              row.id === OWN_ANSWER_ROW
                ? Boolean(picked && picked.other.trim() !== '')
                : Boolean(picked && picked.selected.includes(row.id));
            const mark = item.multiSelect ? (chosen ? '[x]' : '[ ]') : chosen ? '(●)' : '( )';
            return (
              <Box key={row.id}>
                <Text {...(active ? { color: Colors.active } : { dimColor: true })}>{active ? '› ' : '  '}</Text>
                <Text {...(active ? {} : { dimColor: true })}>{`${mark} `}</Text>
                <Text bold={active}>
                  {row.id === OWN_ANSWER_ROW && picked && picked.other.trim() !== '' ? `${row.label}: ${picked.other}` : row.label}
                </Text>
                {row.description ? <Text dimColor>{`  ${row.description}`}</Text> : null}
              </Box>
            );
          })}
        </Box>
      )}
      {sending ? <Text dimColor>Sending the answer…</Text> : null}
      {error ? <Text color={Colors.danger}>{error}</Text> : null}
    </Modal>
  );
};
