import { Box, Text } from 'ink';
import { h, COLORS } from './helpers.js';
import { Message } from './message.js';

export function ChatPanel({ messages, height }) {
  const availableHeight = Math.max(1, (height || 20) - 4);
  const maxMessages = Math.max(1, Math.floor(availableHeight / 2));
  const visible = messages.slice(-maxMessages);

  const children = [
    h(Box, { marginBottom: 1, key: 'title' },
      h(Text, { bold: true, color: COLORS.accent }, ' Chat'),
    ),
  ];

  if (visible.length === 0) {
    children.push(
      h(Text, { color: COLORS.dim, key: 'empty' }, ' No messages yet. Type a task below.')
    );
  } else {
    visible.forEach((msg, i) => {
      children.push(h(Box, { key: `msg-${i}` }, h(Message, { ...msg })));
    });
  }

  return h(Box, {
    flexDirection: 'column',
    flexGrow: 1,
    borderStyle: 'round',
    borderColor: COLORS.border,
    paddingX: 1,
    height,
  }, ...children);
}
