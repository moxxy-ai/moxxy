import React from 'react';
import { Box, Text } from 'ink';
import type { MoxxyEvent } from '@moxxy/sdk';
import { Colors, Glyphs } from '../../theme.js';
import { AssistantBlock } from './AssistantBlock.js';
import { truncate } from './format.js';

export const EventLine: React.FC<{ event: MoxxyEvent }> = ({ event }) => {
  switch (event.type) {
    case 'user_prompt':
      // Highlighted echo bar: bold prompt glyph + the user text, then a
      // dim horizontal rule under it. Matches the Grok-style "pinned
      // user prompt" treatment without needing a full bordered box.
      return (
        <Box flexDirection="column" marginTop={1}>
          <Box>
            <Text>{`${Glyphs.prompt} `}</Text>
            <Text bold>{event.text}</Text>
          </Box>
          <Text dimColor>{'─'.repeat(Math.min(60, event.text.length + 2))}</Text>
        </Box>
      );
    case 'assistant_message':
      return <AssistantBlock content={event.content} />;
    case 'skill_invoked':
      // SkillScopeView owns this render; if we reach here it means the
      // event escaped grouping (defensive fallback only).
      return null;
    case 'skill_created':
      return (
        <Box marginTop={1}>
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
        <Box marginTop={1}>
          <Text dimColor>⤺ </Text>
          <Text dimColor>
            compacted {event.replacedRange[1] - event.replacedRange[0] + 1} events ({truncate(event.summary, 100)})
          </Text>
        </Box>
      );
    case 'error':
      return (
        <Box marginTop={1}>
          <Text color={Colors.danger}>{Glyphs.filled} </Text>
          <Text color={Colors.danger}>error: </Text>
          <Text>{event.message}</Text>
        </Box>
      );
    case 'abort':
      return (
        <Box marginTop={1}>
          <Text color={Colors.busy}>⏹ aborted: {event.reason}</Text>
        </Box>
      );
    default:
      return null;
  }
};
