import { Box, Text } from 'ink';
import { h, COLORS } from './helpers.js';

export function TabBar({ tabs, activeIndex }) {
  return h(Box, { flexDirection: 'row', borderStyle: 'single', borderBottom: true, borderTop: false, borderLeft: false, borderRight: false, paddingLeft: 1 },
    ...tabs.map((tab, i) =>
      h(Box, { key: tab.id, marginRight: 1 },
        h(Text, {
          bold: i === activeIndex,
          color: i === activeIndex ? COLORS.accent : COLORS.dim,
          inverse: i === activeIndex,
        }, ` ${i + 1}: ${tab.label} `)
      )
    ),
    h(Box, { marginLeft: 1 },
      h(Text, { color: COLORS.dim }, '[+]')
    ),
  );
}
