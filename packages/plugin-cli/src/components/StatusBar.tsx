import React from 'react';
import { Box } from 'ink';

export interface StatusBarProps {
  // Intentionally empty for now — the model/provider info moved up next to
  // the logo so the row below the prompt stays visually quiet and reserved
  // for future contextual content (token usage, network status, hints, etc.).
  readonly _placeholder?: never;
}

/**
 * Reserved space below the prompt input. The model + provider info now
 * lives below the logo at the top of the TUI. This component is kept as
 * the slot future indicators can fill (e.g., token counter, vault status,
 * stream rate) without re-shuffling the layout.
 */
export const StatusBar: React.FC<StatusBarProps> = () => <Box marginTop={1} />;
