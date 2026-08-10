import React, { useEffect, useState } from 'react';
import { Text } from 'ink';
import { MOTION_ENABLED } from '../motion.js';

export interface ShimmerSlices {
  readonly before: string;
  readonly glow: string;
  readonly after: string;
}

export interface ShimmerBandSlices {
  readonly leading: string;
  readonly core: string;
  readonly trailing: string;
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

/** Split the moving window into a soft gray → black → gray sweep. */
export function shimmerBandSlices(text: string): ShimmerBandSlices {
  if (text.length === 0) return { leading: '', core: '', trailing: '' };
  if (text.length === 1) return { leading: '', core: text, trailing: '' };
  const edgeWidth = Math.max(1, Math.floor(text.length / 3));
  const coreEnd = Math.max(edgeWidth + 1, text.length - edgeWidth);
  return {
    leading: text.slice(0, edgeWidth),
    core: text.slice(edgeWidth, coreEnd),
    trailing: text.slice(coreEnd),
  };
}

/** Active work stays high-contrast while a dark sweep crosses the label.
 * Motion is skipped for pipes, NO_COLOR and reduced-motion. */
export const ShimmerText: React.FC<{ readonly text: string; readonly active: boolean }> = ({ text, active }) => {
  const [frame, setFrame] = useState(0);
  useEffect(() => {
    if (!active || !MOTION_ENABLED) return;
    const timer = setInterval(() => setFrame((value) => value + 1), 90);
    return () => clearInterval(timer);
  }, [active]);

  if (!active) return <Text dimColor>{text}</Text>;
  if (!MOTION_ENABLED) return <Text bold color="white">{text}</Text>;
  const slices = shimmerSlices(text, frame, 9);
  const band = shimmerBandSlices(slices.glow);
  return (
    <Text bold color="white">
      {slices.before}
      <Text color="gray">{band.leading}</Text>
      <Text color="black">{band.core}</Text>
      <Text color="gray">{band.trailing}</Text>
      {slices.after}
    </Text>
  );
};
