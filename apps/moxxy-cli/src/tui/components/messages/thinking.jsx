import React, { useState, useEffect } from 'react';
import { Box, Text } from 'ink';
import { THEME } from '../../theme.js';

const FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

export function ThinkingIndicator() {
  const [frame, setFrame] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => {
      setFrame(f => (f + 1) % FRAMES.length);
    }, 100);
    return () => clearInterval(timer);
  }, []);

  return (
    <Box marginTop={1}>
      <Text>
        <Text color={THEME.assistant}>{FRAMES[frame]}</Text>
        <Text color={THEME.dim}> thinking...</Text>
      </Text>
    </Box>
  );
}
