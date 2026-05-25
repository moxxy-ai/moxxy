import React from 'react';
import { Box, Text } from 'ink';
import { Glyphs } from '../theme.js';

export type FooterHintMode = 'default' | 'picker' | 'permission' | 'boot';

export interface FooterHintsProps {
  readonly mode?: FooterHintMode;
  /**
   * When true, append the `^R voice` hint to modes that support voice
   * input (`default`, `boot`). False/undefined keeps it hidden so users
   * without a voice plugin / ffmpeg don't see a non-functional shortcut.
   */
  readonly voiceReady?: boolean;
}

interface Hint {
  readonly key: string;
  readonly action: string;
  /** Rank: lower numbers stay visible longer when the terminal narrows. */
  readonly priority: number;
}

const HINTS: Record<FooterHintMode, ReadonlyArray<Hint>> = {
  default: [
    { key: 'Enter', action: 'send', priority: 1 },
    { key: '/help', action: 'commands', priority: 2 },
    { key: 'Esc', action: 'clear / cancel', priority: 3 },
    { key: '⇧Enter', action: 'newline', priority: 4 },
    { key: '^B', action: 'toggle skills', priority: 5 },
  ],
  picker: [
    { key: '↑↓', action: 'navigate', priority: 1 },
    { key: 'Enter', action: 'select', priority: 1 },
    { key: 'Esc', action: 'close', priority: 2 },
  ],
  permission: [
    { key: 'y', action: 'allow', priority: 1 },
    { key: 'a', action: 'session', priority: 2 },
    { key: 'p', action: 'always', priority: 3 },
    { key: 'n', action: 'deny', priority: 1 },
  ],
  boot: [
    { key: 'Enter', action: 'send', priority: 1 },
    { key: '/exit', action: 'quit', priority: 2 },
  ],
};

const VOICE_HINT: Hint = { key: '^R', action: 'voice', priority: 2 };

/**
 * Persistent dim row of keybinding hints. Truncates from highest
 * priority number down so the most useful keys always stay visible
 * even at 40 columns.
 */
export const FooterHints: React.FC<FooterHintsProps> = ({ mode = 'default', voiceReady = false }) => {
  const width = process.stdout.columns ?? 80;
  const base = HINTS[mode];
  const all = voiceReady && (mode === 'default' || mode === 'boot') ? [...base, VOICE_HINT] : base;
  const visible = pickHints(all, width);
  return (
    <Box>
      {visible.map((hint, i) => (
        <React.Fragment key={hint.key + hint.action}>
          {i > 0 ? <Text dimColor>{` ${Glyphs.hintSep} `}</Text> : null}
          <Text>{hint.key}</Text>
          <Text dimColor>{` ${hint.action}`}</Text>
        </React.Fragment>
      ))}
    </Box>
  );
};

function pickHints(all: ReadonlyArray<Hint>, width: number): ReadonlyArray<Hint> {
  const sorted = [...all].sort((a, b) => a.priority - b.priority);
  // Each hint is roughly `<key>` + space + `<action>` + ` │ ` ≈ 14 cols
  // average. Estimate fit and drop the lowest-priority overflow.
  const avgCell = 14;
  const maxCells = Math.max(2, Math.floor(width / avgCell));
  return sorted.slice(0, Math.min(sorted.length, maxCells));
}
