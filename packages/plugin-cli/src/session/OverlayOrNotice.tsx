import React from 'react';
import { Box, Text } from 'ink';
import type { MoxxyEvent } from '@moxxy/sdk';
import type { Session } from '@moxxy/core';
import { SkillsPanel } from '../components/SkillsPanel.js';
import { ToolsPanel } from '../components/ToolsPanel.js';
import { AgentsPanel } from '../components/AgentsPanel.js';
import { deriveMcpServers } from './helpers.js';
import type { Overlay } from './types.js';

interface OverlayOrNoticeProps {
  overlay: Overlay;
  systemNotice: string | null;
  session: Session;
  events: ReadonlyArray<MoxxyEvent>;
  onClose: () => void;
}

export const OverlayOrNotice: React.FC<OverlayOrNoticeProps> = ({
  overlay,
  systemNotice,
  session,
  events,
  onClose,
}) => {
  if (overlay?.kind === 'skills') {
    return (
      <SkillsPanel
        skills={session.skills.list()}
        mcpServers={deriveMcpServers(session.tools.list())}
        onClose={onClose}
      />
    );
  }
  if (overlay?.kind === 'tools') {
    return <ToolsPanel tools={session.tools.list()} onClose={onClose} />;
  }
  if (overlay?.kind === 'agents') {
    return (
      <AgentsPanel events={events} availableKinds={session.agents.list()} onClose={onClose} />
    );
  }
  if (systemNotice) {
    return (
      <Box marginTop={1} marginBottom={1} flexDirection="column">
        {systemNotice.split('\n').map((line, i) => (
          <Text key={i}>{line}</Text>
        ))}
      </Box>
    );
  }
  return null;
};
