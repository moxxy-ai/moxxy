import React, { useEffect } from 'react';
import { Box, Text, useInput } from 'ink';
import type { PendingToolCall, PermissionDecision } from '@moxxy/sdk';

export interface PermissionDialogProps {
  readonly call: PendingToolCall;
  readonly toolDescription?: string;
  readonly onDecide: (decision: PermissionDecision) => void;
}

export const PermissionDialog: React.FC<PermissionDialogProps> = ({ call, toolDescription, onDecide }) => {
  useInput((input, key) => {
    const ch = input.toLowerCase();
    if (ch === 'y' || key.return) onDecide({ mode: 'allow' });
    else if (ch === 'a') onDecide({ mode: 'allow_session' });
    else if (ch === 'p') onDecide({ mode: 'allow_always' });
    else if (ch === 'n' || key.escape) onDecide({ mode: 'deny', reason: 'user declined' });
  });

  useEffect(() => {
    // Auto-focus the dialog by capturing input on mount; useInput handles it.
  }, []);

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="yellow" paddingX={1} paddingY={0}>
      <Text bold color="yellow">Tool permission requested</Text>
      <Text>
        Tool: <Text bold>{call.name}</Text>
        {toolDescription ? <Text dimColor> — {toolDescription}</Text> : null}
      </Text>
      <Text dimColor>Input: {JSON.stringify(call.input).slice(0, 200)}</Text>
      <Text>
        <Text color="green">[y]</Text> allow once · <Text color="green">[a]</Text> allow session ·{' '}
        <Text color="green">[p]</Text> always · <Text color="red">[n]</Text> deny
      </Text>
    </Box>
  );
};
