import React, { useEffect, useState } from 'react';
import { Text } from 'ink';
import { Colors } from '../../theme.js';
import { MOTION_ENABLED } from '../motion.js';

export type ActivityDotState = 'neutral' | 'active' | 'success' | 'error';

/**
 * One semantic marker for transcript activity: white when a unit is loaded,
 * softly blinking while it works, green when it settles, red when it fails.
 * Text and glyphs still carry meaning when color or motion is unavailable.
 */
export const ActivityDot: React.FC<{ readonly state: ActivityDotState }> = ({ state }) => {
  const [bright, setBright] = useState(true);

  useEffect(() => {
    if (state !== 'active' || !MOTION_ENABLED) return;
    const timer = setInterval(() => setBright((value) => !value), 420);
    return () => clearInterval(timer);
  }, [state]);

  if (state === 'success') return <Text color={Colors.active}>•</Text>;
  if (state === 'error') return <Text color={Colors.danger}>•</Text>;
  if (state === 'active') {
    return (
      <Text color={bright || !MOTION_ENABLED ? 'white' : Colors.chrome} dimColor={!bright} bold>
        •
      </Text>
    );
  }
  return <Text color="white">•</Text>;
};
