import React from 'react';
import { Box, Text } from 'ink';
import type { MoxxyEvent } from '@moxxy/sdk';

export interface ChatViewProps {
  readonly events: ReadonlyArray<MoxxyEvent>;
  readonly streamingDelta?: string;
}

export const ChatView: React.FC<ChatViewProps> = ({ events, streamingDelta }) => {
  return (
    <Box flexDirection="column">
      {events.map((e) => (
        <EventLine key={e.id} event={e} />
      ))}
      {streamingDelta ? <Text color="cyan">{streamingDelta}</Text> : null}
    </Box>
  );
};

const EventLine: React.FC<{ event: MoxxyEvent }> = ({ event }) => {
  switch (event.type) {
    case 'user_prompt':
      return (
        <Box>
          <Text color="blue" bold>{'> '}</Text>
          <Text>{event.text}</Text>
        </Box>
      );
    case 'assistant_message':
      return (
        <Box marginY={0}>
          <Text color="cyan">{event.content}</Text>
        </Box>
      );
    case 'tool_call_requested':
      return (
        <Text dimColor>
          → {event.name}({JSON.stringify(event.input).slice(0, 80)})
        </Text>
      );
    case 'tool_call_denied':
      return <Text color="red">  ✗ denied: {event.reason}</Text>;
    case 'tool_result':
      return event.ok ? (
        <Text dimColor>  ✓ result ({truncate(stringify(event.output), 80)})</Text>
      ) : (
        <Text color="red">  ✗ error: {event.error?.message}</Text>
      );
    case 'skill_created':
      return <Text color="green">  + skill created: {event.name}</Text>;
    case 'plugin_registered':
      return <Text dimColor>  + plugin: {event.name}@{event.version}</Text>;
    case 'error':
      return <Text color="red">  ! {event.message}</Text>;
    case 'abort':
      return <Text color="yellow">  ⏹ aborted: {event.reason}</Text>;
    default:
      return null;
  }
};

function stringify(v: unknown): string {
  if (typeof v === 'string') return v;
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : s.slice(0, n) + '…';
}
