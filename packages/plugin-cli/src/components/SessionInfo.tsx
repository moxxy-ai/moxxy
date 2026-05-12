import React from 'react';
import { Box, Text } from 'ink';

export interface SessionInfoProps {
  readonly loop: string;
  readonly provider: string;
  readonly model: string;
  readonly toolCount: number;
  readonly skillCount: number;
  readonly pluginCount: number;
  /** Optional version string rendered above the box; omitted when null. */
  readonly version?: string;
}

/**
 * Welcome / session-info panel. Bordered two-column layout: identity on
 * the left (mascot, active provider, model, loop), quick-reference and
 * load counts on the right. Replaces the older flat key:value table.
 *
 * The provider+model+context meter also lives on the bottom status bar;
 * showing them here too is intentional — this panel is "where am I and
 * what's loaded" at session start, the bar is the live state. Different
 * roles, mild duplication.
 */
export const SessionInfo: React.FC<SessionInfoProps> = ({
  loop,
  provider,
  model,
  toolCount,
  skillCount,
  pluginCount,
  version,
}) => {
  const width = process.stdout.columns ?? 80;
  // Below ~60 cols the two-column layout starts wrapping ugly; fall back
  // to a compact one-liner.
  if (width < 60) {
    return (
      <Box flexDirection="column" marginBottom={1}>
        <Text dimColor>
          {`moxxy${version ? ` ${version}` : ''} · ${provider}:${model} · ${loop}`}
        </Text>
        <Text dimColor>
          {`${toolCount} tools · ${skillCount} skills · ${pluginCount} plugins`}
        </Text>
      </Box>
    );
  }

  // `version` is left in the prop bag for backward compat but we no
  // longer render it here — the Logo already shows it next to the
  // slogan, so a second header above the panel was noisy.
  void version;
  return (
    <Box flexDirection="column" marginBottom={1}>
      <Box
        borderStyle="round"
        borderColor="white"
        borderDimColor
        paddingX={2}
        paddingY={0}
        flexDirection="row"
      >
        {/* Left column: active provider / model / loop. The pixel mascot
            we previously had here looked like a TV face and added more
            visual cost than value — kept the column for identity only. */}
        <Box flexDirection="column" width={20} marginRight={2}>
          <Text dimColor>provider</Text>
          <Text bold color="white">
            {provider}
          </Text>
          <Box marginTop={1}>
            <Text dimColor>model</Text>
          </Box>
          <Text>{model}</Text>
          <Box marginTop={1}>
            <Text dimColor>loop</Text>
          </Box>
          <Text color="magenta">{loop}</Text>
        </Box>

        {/* Right column: quick start + loaded counts */}
        <Box flexDirection="column" flexGrow={1}>
          <Text bold color="yellow">
            Quick start
          </Text>
          <CommandLine cmd="/model" desc="switch provider & model" />
          <CommandLine cmd="/loop" desc="switch loop strategy" />
          <CommandLine cmd="/yolo" desc="toggle auto-approve" />
          <CommandLine cmd="/cancel" desc="abort current turn" />
          <CommandLine cmd="/help" desc="list every command" />

          <Box marginTop={1}>
            <Text bold color="yellow">
              Loaded
            </Text>
          </Box>
          <Box>
            <Text>
              <Text bold>{toolCount}</Text>
              <Text dimColor> tools · </Text>
              <Text bold>{skillCount}</Text>
              <Text dimColor> skills · </Text>
              <Text bold>{pluginCount}</Text>
              <Text dimColor> plugins</Text>
            </Text>
          </Box>
        </Box>
      </Box>
    </Box>
  );
};

const CommandLine: React.FC<{ cmd: string; desc: string }> = ({ cmd, desc }) => (
  <Box>
    <Box width={9}>
      <Text color="green">{cmd}</Text>
    </Box>
    <Text dimColor>— {desc}</Text>
  </Box>
);
