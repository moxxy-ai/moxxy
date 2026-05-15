import React from 'react';
import { Box, Text } from 'ink';
import { RainbowText } from './RainbowText.js';

export interface StatusBarProps {
  readonly provider: string;
  readonly model: string;
  /** Approximate input tokens consumed so far. */
  readonly contextUsed?: number;
  /** Active model's context window size. Required for the percentage. */
  readonly contextWindow?: number;
  /** Auto-approve mode active — animated rainbow badge on the right. */
  readonly yolo?: boolean;
  /**
   * MCP attach summary: how many configured-and-enabled servers are
   * currently live. Shown as `mcp <connected>/<enabled>` between the
   * model name and the context meter. Hidden when no servers configured.
   */
  readonly mcp?: { readonly connected: number; readonly enabled: number };
}

/**
 * Row below the prompt input. Left side: provider chip + model name.
 * Right side: context-window meter and, when yolo mode is on, an
 * animated rainbow "YOLO MODE" indicator so it's loud enough to remind
 * the user that tool calls are being auto-approved.
 */
export const StatusBar: React.FC<StatusBarProps> = ({
  provider,
  model,
  contextUsed,
  contextWindow,
  yolo,
  mcp,
}) => (
  <Box justifyContent="space-between">
    <Box>
      <Text backgroundColor="magenta" color="white" bold>{` ${provider} `}</Text>
      <Text dimColor>{`  ${model}`}</Text>
      {mcp && mcp.enabled > 0 ? <McpChip mcp={mcp} /> : null}
    </Box>
    <Box>
      {contextWindow ? <ContextMeter used={contextUsed ?? 0} total={contextWindow} /> : null}
      {yolo ? (
        <>
          {contextWindow ? <Text>  </Text> : null}
          <RainbowText bold>YOLO MODE</RainbowText>
        </>
      ) : null}
    </Box>
  </Box>
);

const McpChip: React.FC<{ mcp: { connected: number; enabled: number } }> = ({ mcp }) => {
  // Green when everything is live; yellow while waiting for at least one
  // lazy stub to connect; dim when nothing is enabled.
  const color = mcp.connected === mcp.enabled ? 'green' : mcp.connected > 0 ? 'yellow' : undefined;
  return (
    <Box>
      <Text dimColor>{'  mcp '}</Text>
      <Text color={color}>{`${mcp.connected}/${mcp.enabled}`}</Text>
    </Box>
  );
};

const ContextMeter: React.FC<{ used: number; total: number }> = ({ used, total }) => {
  const pct = Math.min(100, Math.round((used / total) * 100));
  // Color the percentage by how close we are to the limit; the meter
  // becomes the "you're running out of room" warning surface.
  const color = pct >= 85 ? 'red' : pct >= 60 ? 'yellow' : undefined;
  return (
    <Box>
      <Text dimColor>context </Text>
      <Text color={color}>{formatTokens(used)}</Text>
      <Text dimColor>{` / ${formatTokens(total)} `}</Text>
      <Text color={color}>{`(${pct}%)`}</Text>
    </Box>
  );
};

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}
