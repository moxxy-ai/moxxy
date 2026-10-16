import React from 'react';
import { Box, Text } from 'ink';
import type { RecordedAccountLimit } from '@moxxy/sdk';
import { accountLimitText } from '@moxxy/chat-model';
import { Colors } from '../theme.js';

/** Above the prompt while the active agent's account limit is nearly or wholly used up, until it resets. */
export const AccountLimitLine: React.FC<{ readonly limit: RecordedAccountLimit; readonly nowMs: number }> = ({ limit, nowMs }) => (
  <Box>
    <Text color={limit.limit.state === 'reached' ? Colors.danger : Colors.busy}>●</Text>
    <Text>{` ${accountLimitText(limit, nowMs)}`}</Text>
  </Box>
);
