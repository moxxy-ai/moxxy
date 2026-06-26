import React from 'react';
import { Box, Text } from 'ink';
import type { MoxxyEvent } from '@moxxy/sdk';
import type { ClientSession as Session } from '@moxxy/sdk';
import { SkillsPanel } from '../components/SkillsPanel.js';
import { ToolsPanel } from '../components/ToolsPanel.js';
import { AgentsPanel } from '../components/AgentsPanel.js';
import { UsagePanel } from '../components/UsagePanel.js';
import { WorkflowsPanel } from '../components/WorkflowsPanel.js';
import { ChannelsPanel } from '../components/ChannelsPanel.js';
import { Colors, noColor } from '../theme.js';
import { deriveMcpServers } from './helpers.js';
import type { ChannelDef } from '@moxxy/sdk';
import type { Overlay } from './types.js';
import type { VaultLike } from './props.js';

interface OverlayOrNoticeProps {
  overlay: Overlay;
  systemNotice: string | null;
  session: Session;
  events: ReadonlyArray<MoxxyEvent>;
  contextWindow?: number | null;
  contextTokens?: number | null;
  getVault?: () => VaultLike | null;
  getChannels?: () => ReadonlyArray<ChannelDef>;
  onClose: () => void;
}

export const OverlayOrNotice: React.FC<OverlayOrNoticeProps> = ({
  overlay,
  systemNotice,
  session,
  events,
  contextWindow,
  contextTokens,
  getVault,
  getChannels,
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
  if (overlay?.kind === 'workflows') {
    return <WorkflowsPanel view={session.workflows ?? null} onClose={onClose} />;
  }
  if (overlay?.kind === 'channels') {
    return (
      <ChannelsPanel
        channels={getChannels?.() ?? []}
        vault={getVault?.() ?? null}
        onClose={onClose}
      />
    );
  }
  if (overlay?.kind === 'agents') {
    return (
      <AgentsPanel events={events} availableKinds={session.agents.list()} onClose={onClose} />
    );
  }
  if (overlay?.kind === 'usage') {
    return (
      <UsagePanel
        events={events}
        contextWindow={contextWindow ?? null}
        contextTokens={contextTokens ?? null}
        onClose={onClose}
      />
    );
  }
  if (systemNotice) {
    return <SystemNotice notice={systemNotice} />;
  }
  return null;
};

interface VoiceNoticeStyle {
  readonly label: string;
  readonly accent: string;
  readonly textColor: 'black' | 'white';
  /** Strips the routing prefix so the displayed body reads naturally. */
  readonly body: string;
}

/**
 * Voice notices ride the shared `systemNotice` channel but matter more
 * to the user than e.g. a `/help` message, so they render as a colored
 * pill + body block. Non-voice notices keep the original plain layout.
 */
function classifyVoiceNotice(notice: string): VoiceNoticeStyle | null {
  if (!notice.startsWith('voice:')) return null;
  const body = notice.slice('voice:'.length).trim();
  const lower = body.toLowerCase();
  // Each phase carries a distinct label + glyph so the state is legible
  // without relying on the accent hue alone (color-vision deficiency,
  // monochrome terminals, NO_COLOR). The error pill gets a ✗ marker so it is
  // not confused with the success/empty VOICE pill, which differ from it only
  // by accent color otherwise.
  if (lower.startsWith('recording')) {
    return { label: ' ● REC ', accent: Colors.danger, textColor: 'black', body };
  }
  if (lower.startsWith('transcribing')) {
    return { label: ' … TRANSCRIBING ', accent: Colors.busy, textColor: 'black', body };
  }
  if (lower.startsWith('transcript inserted')) {
    return { label: ' ✓ VOICE ', accent: Colors.active, textColor: 'black', body };
  }
  if (lower.includes('empty transcript')) {
    return { label: ' ∅ VOICE ', accent: Colors.busy, textColor: 'black', body };
  }
  // Errors, readiness gripes, missing-ffmpeg, etc.
  return { label: ' ✗ VOICE ', accent: Colors.danger, textColor: 'black', body };
}

export const SystemNotice: React.FC<{ notice: string }> = ({ notice }) => {
  const voice = classifyVoiceNotice(notice);
  if (voice) {
    const lines = voice.body.split('\n');
    const [first, ...rest] = lines;
    // NO_COLOR: drop the reverse-video pill (which is invisible without
    // color) for a bracketed text label so the phase marker stays legible.
    const plain = noColor();
    return (
      <Box marginTop={1} marginBottom={1} flexDirection="column">
        <Box>
          {plain ? (
            <Text bold>{`[${voice.label.trim()}]`}</Text>
          ) : (
            <Text backgroundColor={voice.accent} color={voice.textColor} bold>
              {voice.label}
            </Text>
          )}
          <Text {...(plain ? { bold: true } : { color: voice.accent, bold: true })}>{` ${first ?? ''}`}</Text>
        </Box>
        {rest.map((line, i) => (
          <Text key={i} dimColor>
            {' '.repeat(voice.label.length + 1)}
            {line}
          </Text>
        ))}
      </Box>
    );
  }
  return (
    <Box marginTop={1} marginBottom={1} flexDirection="column">
      {notice.split('\n').map((line, i) => (
        <Text key={i}>{line}</Text>
      ))}
    </Box>
  );
};
