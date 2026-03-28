import React from 'react';
import { Box, Text } from 'ink';
import { THEME } from '../theme.js';
import { UserMessage } from './messages/user-message.jsx';
import { AssistantMessage } from './messages/assistant-message.jsx';
import { ToolMessage } from './messages/tool-message.jsx';
import { SkillMessage } from './messages/skill-message.jsx';
import { ToolGroup } from './messages/tool-group.jsx';
import { SystemMessage } from './messages/system-message.jsx';
import { AskMessage } from './messages/ask-message.jsx';
import { EventMessage } from './messages/event-message.jsx';
import { HiveStatus } from './messages/hive-status.jsx';
import { ChannelMessage } from './messages/channel-message.jsx';
import { ThinkingIndicator } from './messages/thinking.jsx';

function isToolish(msg) {
  return msg.type === 'tool' || msg.type === 'skill';
}

function groupMessages(messages) {
  const groups = [];
  let currentToolGroup = null;

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    if (isToolish(msg)) {
      if (!currentToolGroup) {
        currentToolGroup = [];
      }
      currentToolGroup.push(msg);
    } else {
      if (currentToolGroup) {
        groups.push({ type: 'tool-group', messages: currentToolGroup, startIdx: i - currentToolGroup.length });
        currentToolGroup = null;
      }
      groups.push(msg);
    }
  }
  if (currentToolGroup) {
    groups.push({ type: 'tool-group', messages: currentToolGroup, startIdx: messages.length - currentToolGroup.length });
  }
  return groups;
}

function renderItem(item, index, agentName, toolsExpanded) {
  if (item.type === 'tool-group') {
    if (item.messages.length === 1) {
      const msg = item.messages[0];
      const inner = msg.type === 'skill'
        ? <SkillMessage key={`tg-${index}`} msg={msg} showDetails={toolsExpanded} />
        : <ToolMessage key={`tg-${index}`} msg={msg} showDetails={toolsExpanded} />;
      return <Box key={`tg-${index}`} flexDirection="column" marginTop={1}>{inner}</Box>;
    }
    return <ToolGroup key={`tg-${index}`} messages={item.messages} expanded={toolsExpanded} />;
  }
  switch (item.type) {
    case 'user':
      return <UserMessage key={index} msg={item} />;
    case 'assistant':
      return <AssistantMessage key={index} msg={item} agentName={agentName} />;
    case 'system':
      return <SystemMessage key={index} msg={item} />;
    case 'ask':
      return <AskMessage key={index} msg={item} />;
    case 'event':
    case 'hive-event':
      return <EventMessage key={index} msg={item} />;
    case 'hive-status':
      return <HiveStatus key={index} msg={item} />;
    case 'channel':
      return <ChannelMessage key={index} msg={item} />;
    default:
      return null;
  }
}

// Header ~9 lines, input area ~4 lines, padding ~2
const CHROME_LINES = 15;
// Rough estimate: each message group takes ~3 lines (label + content + margin)
const LINES_PER_GROUP = 3;

export function ChatPanel({ messages, thinking, agentName, scrollOffset = 0, toolsExpanded = false, termHeight = 40 }) {
  const groups = groupMessages(messages);
  const total = groups.length;

  // Calculate how many groups we can fit on screen
  const availableLines = Math.max(6, termHeight - CHROME_LINES);
  const maxVisible = Math.max(1, Math.floor(availableLines / LINES_PER_GROUP));

  // scrollOffset = number of groups from the end to skip
  const clampedOffset = Math.min(scrollOffset, Math.max(0, total - 1));
  const endIdx = total - clampedOffset;
  const startIdx = Math.max(0, endIdx - maxVisible);
  const visible = endIdx > 0 ? groups.slice(startIdx, endIdx) : [];
  const isScrolled = clampedOffset > 0;
  const hasOlderMessages = startIdx > 0;

  return (
    <Box flexDirection="column" paddingLeft={2} paddingRight={1} paddingY={1}>
      {hasOlderMessages && (
        <Box justifyContent="center">
          <Text color={THEME.dim}>── {startIdx} older message{startIdx !== 1 ? 's' : ''} (Shift+↑ to scroll) ──</Text>
        </Box>
      )}
      {visible.length === 0 && !hasOlderMessages ? (
        <Box paddingTop={1}>
          <Text color={THEME.dim}>No messages yet. Type a task or /help for commands.</Text>
        </Box>
      ) : (
        visible.map((item, i) => renderItem(item, i, agentName, toolsExpanded))
      )}
      {thinking && !isScrolled && <ThinkingIndicator />}
      {isScrolled && (
        <Box justifyContent="center" marginTop={1}>
          <Text color={THEME.dim}>── {clampedOffset} newer message{clampedOffset !== 1 ? 's' : ''} (Shift+↓ to scroll) ──</Text>
        </Box>
      )}
    </Box>
  );
}
