import React from 'react';
import { Box, Text } from 'ink';

export interface SessionInfoProps {
  readonly provider: string;
  readonly model: string;
  readonly loop: string;
  readonly toolCount: number;
  readonly toolPreview: ReadonlyArray<string>;
  readonly skillCount: number;
  readonly skillPreview: ReadonlyArray<string>;
  readonly pluginCount: number;
}

/**
 * Header table shown below the logo. Two columns: dim label, value with
 * subtle accents. Provider renders as a chip; loop/tools/skills as dim
 * text with a short comma-separated preview when there's room.
 *
 * Kept compact (no borders, no separators) so it reads as part of the
 * banner rather than a competing UI block.
 */
export const SessionInfo: React.FC<SessionInfoProps> = ({
  provider,
  model,
  loop,
  toolCount,
  toolPreview,
  skillCount,
  skillPreview,
  pluginCount,
}) => {
  const labelWidth = 9;
  return (
    <Box flexDirection="column" marginBottom={1}>
      <Row label="provider" labelWidth={labelWidth}>
        <Text backgroundColor="magenta" color="white" bold>{` ${provider} `}</Text>
        <Text dimColor>{`  ${model}`}</Text>
      </Row>
      <Row label="loop" labelWidth={labelWidth}>
        <Text color="cyan">{loop}</Text>
      </Row>
      <Row label="tools" labelWidth={labelWidth}>
        <Text>{String(toolCount)}</Text>
        {toolPreview.length > 0 ? (
          <Text dimColor>{`  ${formatPreview(toolPreview, toolCount)}`}</Text>
        ) : null}
      </Row>
      <Row label="skills" labelWidth={labelWidth}>
        <Text>{String(skillCount)}</Text>
        {skillPreview.length > 0 ? (
          <Text dimColor>{`  ${formatPreview(skillPreview, skillCount)}`}</Text>
        ) : null}
      </Row>
      <Row label="plugins" labelWidth={labelWidth}>
        <Text>{String(pluginCount)}</Text>
      </Row>
    </Box>
  );
};

const Row: React.FC<{ label: string; labelWidth: number; children?: React.ReactNode }> = ({
  label,
  labelWidth,
  children,
}) => (
  <Box>
    <Box width={labelWidth}>
      <Text dimColor>{label}</Text>
    </Box>
    {children}
  </Box>
);

function formatPreview(items: ReadonlyArray<string>, total: number): string {
  if (items.length === 0) return '';
  const shown = items.join(', ');
  if (total > items.length) return `${shown}, +${total - items.length} more`;
  return shown;
}
