import React, { useEffect, useState } from 'react';
import { Text } from 'ink';

const COLORS = ['red', 'yellow', 'green', 'cyan', 'blue', 'magenta'] as const;

export interface RainbowTextProps {
  readonly children: string;
  readonly intervalMs?: number;
  readonly bold?: boolean;
}

/**
 * Per-character rainbow color cycle. Each character of the input string
 * is rendered with its own color, and the whole hue palette shifts on a
 * timer so the text appears to flow. Used as the "you're in yolo mode"
 * indicator — visually loud is the point.
 */
export const RainbowText: React.FC<RainbowTextProps> = ({
  children,
  intervalMs = 120,
  bold,
}) => {
  const [offset, setOffset] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setOffset((o) => (o + 1) % COLORS.length), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);

  return (
    <Text>
      {Array.from(children).map((ch, i) => (
        <Text key={i} bold={bold} color={COLORS[(i + offset) % COLORS.length]}>
          {ch}
        </Text>
      ))}
    </Text>
  );
};
