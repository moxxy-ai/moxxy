import React from 'react';
import { Box, Text, useInput } from 'ink';
import { Border, Colors } from '../theme.js';

export interface ModalTab {
  readonly id: string;
  readonly label: string;
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
        const next = tabs[(start - 1 + tabs.length) % tabs.length]!;
        onTabChange!(next.id);
      } else if (key.rightArrow) {
        const next = tabs[(start + 1) % tabs.length]!;
        onTabChange!(next.id);
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

const BAND_BG = Colors.chrome;       // mid-tone gray fill for the heading row
const ACTIVE_TAB_BG = 'white';       // inverse pill that pops off the gray band
const ACTIVE_TAB_FG = 'black';
const INACTIVE_TAB_FG = 'white';     // visible-but-quiet against the gray band

/**
 * Full-row gray heading band carrying the title and optional tabs.
 * The band sits flush against the box borders (no outer padding) and
 * carries its own internal padding so the title has breathing room
 * without indenting the band itself.
 *
 * Width is computed from `process.stdout.columns` minus the 2 border
 * cells. The min floor (20) is a safety net for narrow terminals;
 * Ink truncates beyond the box width anyway.
 *
 * Tabs render inline on the band:
 * - Active tab → inverse white pill (white bg, black bold) — pops off
 *   the gray band so it reads as the current view at a glance.
 * - Inactive tab → gray-on-gray cell with plain white text — the band
 *   bg is preserved so the row feels like one cohesive surface.
 */
const HeaderBand: React.FC<{
  title: string;
  tabs: ReadonlyArray<ModalTab> | undefined;
  activeTabId: string | undefined;
}> = ({ title, tabs, activeTabId }) => {
  const termWidth = process.stdout.columns ?? 80;
  const innerWidth = Math.max(20, termWidth - 2);

  // Internal padding lives inside the band so the title and tabs feel
  // like proper inset "chips" rather than text glued to the band edge.
  // Title: 6 cells of band on each side. Tabs: 4 cells of pill bg on
  // each side. Inter-tab gap: 4 band cells so adjacent tabs read as
  // distinct chips, not a continuous strip.
  const titleText = `      ${title}      `;
  let used = titleText.length;

  const tabNodes: React.ReactNode[] = [];
  if (tabs && tabs.length > 0) {
    tabs.forEach((tab, i) => {
      if (i > 0) {
        tabNodes.push(
          <Text key={`gap-${tab.id}`} backgroundColor={BAND_BG}>
            {'  '}
          </Text>,
        );
        used += 2;
      }
      const focused = tab.id === activeTabId;
      const label = ` ${tab.label} `;
      tabNodes.push(
        focused ? (
          <Text key={tab.id} backgroundColor={ACTIVE_TAB_BG} color={ACTIVE_TAB_FG} bold>
            {label}
          </Text>
        ) : (
          <Text key={tab.id} backgroundColor={BAND_BG} color={INACTIVE_TAB_FG}>
            {label}
          </Text>
        ),
      );
      used += label.length;
    });
  }

  const trailingPadding = ' '.repeat(Math.max(0, innerWidth - used));
  // Full-width blank band row used as vertical padding above and below
  // the content row so the heading reads as a proper title block, not a
  // single tight line. `height={1}` is required — without it Ink can
  // collapse a Box whose only child is a whitespace `Text` to zero
  // height, which would surface as a dark gap between the border and
  // the band.
  const blankBandRow = ' '.repeat(innerWidth);
  const renderBlankRow = (key: string): React.ReactElement => (
    <Box key={key} width="100%" height={1}>
      <Text backgroundColor={BAND_BG}>{blankBandRow}</Text>
    </Box>
  );

  return (
    <Box flexDirection="column" width="100%">
      {renderBlankRow('top')}
      <Box width="100%" height={1}>
        <Text backgroundColor={BAND_BG} color="white" bold>
          {titleText}
        </Text>
        {tabNodes}
        <Text backgroundColor={BAND_BG}>{trailingPadding}</Text>
      </Box>
      {renderBlankRow('bottom')}
    </Box>
  );
};

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
  if (tabsNavigable) parts.push('←/→ tabs');
  if (hasClose) parts.push('Esc close');
  if (parts.length === 0) return null;
  return parts.join(' · ');
}
