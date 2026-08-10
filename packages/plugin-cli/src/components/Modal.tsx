import React from 'react';
import { Box, Text, useInput, useStdout } from 'ink';
import { Border } from '../theme.js';
import { terminalSafeText } from './terminal-text.js';

export interface ModalTab {
  readonly id: string;
  readonly label: string;
}

export interface ModalTabSummary {
  readonly label: string;
  readonly index: number;
  readonly total: number;
}

export interface ModalProps {
  /** Bold title rendered inside the magenta header band. */
  readonly title: string;
  /**
   * Optional one-line search / status line under the title (e.g.
   * `/ to search` or `3 of 42`). Rendered dim.
   */
  readonly subtitle?: string;
  /** Single-line key-hint row rendered at the bottom of the box. */
  readonly hints?: string;
  /**
   * Tabs strip rendered next to the title inside the heading band. When
   * `onTabChange` is provided, the modal owns ←/→ navigation and
   * notifies the parent. Active tabs render as a chrome pill on top of
   * the magenta band; inactive tabs sit flat on the band.
   */
  readonly tabs?: ReadonlyArray<ModalTab>;
  readonly activeTabId?: string;
  readonly onTabChange?: (tabId: string) => void;
  /**
   * Closes the modal cleanly. When set, the modal owns Esc so consumers
   * don't need to plumb it through every scroll list — and so a modal
   * with no inner list (a static info panel) still closes the same way.
   */
  readonly onClose?: () => void;
  readonly children: React.ReactNode;
}

/**
 * Bordered floating panel rendered above the input. The header is a
 * full-width inverse-magenta band that carries the title (and optional
 * tabs) so the modal reads as a single decisive unit instead of a
 * generic bordered Box.
 *
 * Render contract:
 * - SessionView hides ChatView's live area while a modal is open, so
 *   the on-screen live height stays bounded (this Modal + the input).
 *   That avoids Ink's "dynamic height ≥ terminal rows" fallback which
 *   otherwise pushes the modal into scrollback and leaves ghost text
 *   after dismissal.
 * - The Static, already-flushed chat scrollback stays visible above —
 *   so opening /skills feels like a panel sliding over the prompt, not
 *   a screen wipe.
 */
export const Modal: React.FC<ModalProps> = ({
  title,
  subtitle,
  hints,
  tabs,
  activeTabId,
  onTabChange,
  onClose,
  children,
}) => {
  const tabsNavigable = !!(tabs && tabs.length > 1 && onTabChange);

  useInput(
    (_input, key) => {
      if (key.escape && onClose) {
        onClose();
        return;
      }
      if (!tabsNavigable || !tabs) return;
      const idx = tabs.findIndex((t) => t.id === activeTabId);
      const start = idx >= 0 ? idx : 0;
      if (key.leftArrow) {
        const next = tabs[(start - 1 + tabs.length) % tabs.length];
        if (next && onTabChange) onTabChange(next.id);
      } else if (key.rightArrow) {
        const next = tabs[(start + 1) % tabs.length];
        if (next && onTabChange) onTabChange(next.id);
      }
    },
    { isActive: !!(onClose || tabsNavigable) },
  );

  const composedHints = composeHints({ hints, hasClose: !!onClose, tabsNavigable });

  return (
    <Box width="100%" marginTop={1}>
      <Box
        flexDirection="column"
        width="100%"
        borderStyle={Border.style}
        borderColor={Border.color}
        borderDimColor={Border.dim}
      >
        <HeaderBand title={title} tabs={tabs} activeTabId={activeTabId} />
        <Box flexDirection="column" paddingX={1}>
          {subtitle ? (
            <Box marginTop={1}>
              <Text dimColor>{subtitle}</Text>
            </Box>
          ) : null}
          <Box flexDirection="column" marginTop={1}>
            {children}
          </Box>
          {composedHints ? (
            <Box marginTop={1}>
              <Text dimColor>{composedHints}</Text>
            </Box>
          ) : null}
        </Box>
      </Box>
    </Box>
  );
};

const ACTIVE_TAB_BG = 'white';       // inverse pill marking the current tab
const ACTIVE_TAB_FG = 'black';

/**
 * Clean heading row carrying the title and optional tabs as plain text on
 * the terminal background — no filled band (which rendered as dark "bars" on
 * many terminals). A `marginTop` separates it from the top border.
 *
 * A provider/model picker can have many tabs. Rendering all of them wraps the
 * header on an ordinary 80-column terminal, so the header shows one compact
 * switch: current tab + position. Arrow hints make the full set navigable.
 */
const HeaderBand: React.FC<{
  title: string;
  tabs: ReadonlyArray<ModalTab> | undefined;
  activeTabId: string | undefined;
}> = ({ title, tabs, activeTabId }) => {
  const { stdout } = useStdout();
  const columns = stdout?.columns ?? 80;
  const maxTabLabel = Math.max(8, Math.min(34, columns - title.length - 18));
  const summary = summarizeModalTabs(tabs ?? [], activeTabId, maxTabLabel);

  return (
    <Box width="100%" paddingX={1} marginTop={1} justifyContent="space-between">
      <Text color="white" bold>
        {title}
      </Text>
      {summary ? (
        <Box>
          <Text dimColor>{'‹ '}</Text>
          <Text backgroundColor={ACTIVE_TAB_BG} color={ACTIVE_TAB_FG} bold>
            {` ${summary.label} `}
          </Text>
          <Text dimColor>{` ›  ${summary.index}/${summary.total}`}</Text>
        </Box>
      ) : null}
    </Box>
  );
};

export function summarizeModalTabs(
  tabs: ReadonlyArray<ModalTab>,
  activeTabId: string | undefined,
  maxLabel: number,
): ModalTabSummary | null {
  if (tabs.length === 0) return null;
  const activeIndex = tabs.findIndex((tab) => tab.id === activeTabId);
  const resolvedIndex = activeIndex >= 0 ? activeIndex : 0;
  const activeTab = tabs[resolvedIndex];
  if (!activeTab) return null;
  return {
    label: terminalSafeText(activeTab.label, maxLabel),
    index: resolvedIndex + 1,
    total: tabs.length,
  };
}

function composeHints({
  hints,
  hasClose,
  tabsNavigable,
}: {
  hints: string | undefined;
  hasClose: boolean;
  tabsNavigable: boolean;
}): string | null {
  const parts: string[] = [];
  if (hints) parts.push(hints);
  if (tabsNavigable) parts.push('←/→ switch');
  if (hasClose) parts.push('Esc close');
  if (parts.length === 0) return null;
  return parts.join(' · ');
}
