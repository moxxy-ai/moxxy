import { Box, Text } from 'ink';
import { h, COLORS } from './helpers.js';

export function SlashPopup({ commands, selectedIndex }) {
  if (!commands || commands.length === 0) return null;

  const items = commands.map((cmd, i) => {
    const isSelected = i === selectedIndex;
    return h(Box, { key: cmd.name, paddingX: 1 },
      h(Text, {
        color: isSelected ? 'black' : COLORS.accent,
        backgroundColor: isSelected ? COLORS.accent : undefined,
        bold: isSelected,
      }, cmd.name),
      h(Text, { color: COLORS.dim }, `  ${cmd.description}`),
    );
  });

  return h(Box, {
    flexDirection: 'column',
    borderStyle: 'round',
    borderColor: COLORS.accent,
    paddingX: 1,
  }, ...items);
}
