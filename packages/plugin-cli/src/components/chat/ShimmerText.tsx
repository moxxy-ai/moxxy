import React, { useEffect, useState } from 'react';
import { Text } from 'ink';
import { MOTION_ENABLED } from '../motion.js';

export interface ShimmerSlices {
  readonly before: string;
  readonly glow: string;
  readonly after: string;
}

/** Pure frame helper kept separate so the terminal animation is testable. */
export function shimmerSlices(text: string, frame: number, width = 6): ShimmerSlices {
  if (!text) return { before: '', glow: '', after: '' };
  const safeWidth = Math.max(1, Math.min(width, text.length));
  const start = (frame % (text.length + safeWidth)) - safeWidth;
  const from = Math.max(0, start);
  const to = Math.min(text.length, start + safeWidth);
  return {
    before: text.slice(0, from),
    glow: to > from ? text.slice(from, to) : '',
    after: text.slice(Math.max(from, to)),
  };
}

/** ANSI approximation of the desktop luminance sweep: dim text with a small,
 * moving bold window. Motion is skipped for pipes, NO_COLOR and reduced-motion. */
export const ShimmerText: React.FC<{ readonly text: string; readonly active: boolean }> = ({ text, active }) => {
  const [frame, setFrame] = useState(0);
  useEffect(() => {
    if (!active || !MOTION_ENABLED) return;
    const timer = setInterval(() => setFrame((value) => value + 1), 90);
    return () => clearInterval(timer);
  }, [active]);

  if (!active || !MOTION_ENABLED) return <Text dimColor>{text}</Text>;
  const slices = shimmerSlices(text, frame);
  return (
    <Text>
      <Text dimColor>{slices.before}</Text>
      <Text bold>{slices.glow}</Text>
      <Text dimColor>{slices.after}</Text>
    </Text>
  );
};
