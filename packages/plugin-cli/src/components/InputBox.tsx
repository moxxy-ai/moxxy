import React from 'react';
import { Box, Text } from 'ink';
import { Border, Colors } from '../theme.js';
import { PromptInput, type PromptInputProps } from './PromptInput.js';

export interface InputBoxProps extends PromptInputProps {
  /** Active model name (e.g. `claude-sonnet-4-6`). Bottom-right corner. */
  readonly model?: string;
  /** Approval mode badge text. Renders after the model. */
  readonly modeBadge?: string;
  /**
   * Auto-approve mode active. Paints the entire input chrome yellow
   * (border + an inset `YOLO` tab on the top edge) so the user can
   * never forget tool calls are being auto-allowed.
   */
  readonly yolo?: boolean;
}

const YOLO_LABEL = ' YOLO ';
/** How many border dashes to keep between the label and the top-right
 *  corner — a single dash so the badge sits visually attached to the
 *  corner without touching it. */
const RIGHT_PAD = 1;

/**
 * Bordered wrapper around `PromptInput`. The rounded border lives here
 * (PromptInput stays borderless). When `yolo` is true, the standard
 * top edge is replaced with a hand-drawn row containing an inverse-
 * yellow `YOLO` tab embedded in the border, mirroring the reference
 * design where the tab character-overlaps the border line.
 */
export const InputBox: React.FC<InputBoxProps> = ({ model, modeBadge, yolo, ...input }) => {
  if (yolo) {
    return <YoloInputBox model={model} modeBadge={modeBadge} {...input} />;
  }
  return (
    <Box flexDirection="column" marginTop={1} width="100%">
      <Box
        flexDirection="column"
        width="100%"
        borderStyle={Border.style}
        borderColor={Border.color}
        borderDimColor={Border.dim}
      >
        <PromptInput {...input} />
      </Box>
      {model || modeBadge ? <BottomBadge model={model} modeBadge={modeBadge} /> : null}
    </Box>
  );
};

/**
 * YOLO variant: top edge is hand-drawn so the `YOLO` label can sit IN
 * the border line. The rest of the box uses Ink's normal rounded
 * border with the top edge disabled.
 */
const YoloInputBox: React.FC<Omit<InputBoxProps, 'yolo'>> = ({
  model,
  modeBadge,
  ...input
}) => {
  const term = process.stdout.columns ?? 80;
  const innerWidth = Math.max(YOLO_LABEL.length + 4, term - 2);
  const dashesBefore = Math.max(1, innerWidth - YOLO_LABEL.length - RIGHT_PAD);
  return (
    <Box flexDirection="column" marginTop={1} width="100%">
      <Box>
        <Text color={Colors.busy}>{'╭' + '─'.repeat(dashesBefore)}</Text>
        <Text backgroundColor={Colors.busy} color="black" bold>{YOLO_LABEL}</Text>
        <Text color={Colors.busy}>{'─'.repeat(RIGHT_PAD) + '╮'}</Text>
      </Box>
      <Box
        flexDirection="column"
        width="100%"
        borderStyle={Border.style}
        borderColor={Colors.busy}
        borderTop={false}
      >
        <PromptInput {...input} />
      </Box>
      {model || modeBadge ? <BottomBadge model={model} modeBadge={modeBadge} /> : null}
    </Box>
  );
};

const BottomBadge: React.FC<{ model?: string; modeBadge?: string }> = ({ model, modeBadge }) => (
  <Box justifyContent="flex-end">
    <Text dimColor>
      {model ?? ''}
      {model && modeBadge ? ' · ' : ''}
      {modeBadge ?? ''}
    </Text>
  </Box>
);
