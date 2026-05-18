import React from 'react';
import { Box, Text } from 'ink';
import { Border } from '../theme.js';

export interface ModalProps {
  /** Bold title rendered at the top-left of the bordered box. */
  readonly title: string;
  /**
   * Optional one-line search / status line under the title (e.g.
   * `/ to search` or `3 of 42`). Rendered dim.
   */
  readonly subtitle?: string;
  /** Single-line key-hint row rendered at the bottom of the box. */
  readonly hints?: string;
  /**
   * Tabs strip rendered next to the title. Active tab is bold/default,
   * others dim.
   */
  readonly tabs?: ReadonlyArray<{ readonly id: string; readonly label: string }>;
  readonly activeTabId?: string;
  readonly children: React.ReactNode;
}

/**
 * Floating panel container. Spans the full terminal width so list
 * content (skills/tools/pickers) has room to breathe and the eye
 * doesn't have to traverse a narrow centered column.
 */
export const Modal: React.FC<ModalProps> = ({
  title,
  subtitle,
  hints,
  tabs,
  activeTabId,
  children,
}) => {
  return (
    <Box width="100%" marginTop={1}>
      <Box
        flexDirection="column"
        width="100%"
        borderStyle={Border.style}
        borderColor={Border.color}
        borderDimColor={Border.dim}
        paddingX={1}
        paddingY={0}
      >
        <Box>
          <Text bold>{title}</Text>
          {tabs ? (
            <Box marginLeft={2}>
              {tabs.map((tab, i) => {
                const focused = tab.id === activeTabId;
                return (
                  <React.Fragment key={tab.id}>
                    {i > 0 ? <Text dimColor>{`  `}</Text> : null}
                    <Text {...(focused ? { bold: true } : { dimColor: true })}>{tab.label}</Text>
                  </React.Fragment>
                );
              })}
            </Box>
          ) : null}
        </Box>
        {subtitle ? (
          <Box marginTop={1}>
            <Text dimColor>{subtitle}</Text>
          </Box>
        ) : null}
        <Box flexDirection="column" marginTop={1}>
          {children}
        </Box>
        {hints ? (
          <Box marginTop={1}>
            <Text dimColor>{hints}</Text>
          </Box>
        ) : null}
      </Box>
    </Box>
  );
};
