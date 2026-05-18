import { useEffect, useState } from 'react';
import { useInput } from 'ink';

export interface ScrollableListResult {
  /** First visible row index (inclusive). */
  readonly offset: number;
  /** Number of rows the window can show. */
  readonly windowSize: number;
  /** Active row index (cursor). */
  readonly cursor: number;
  /** Total row count. */
  readonly total: number;
  /** Slice the caller should render — `items.slice(offset, offset+windowSize)`. */
  readonly visible: { readonly start: number; readonly end: number };
  /** True when a row above the window exists. */
  readonly canScrollUp: boolean;
  /** True when a row below the window exists. */
  readonly canScrollDown: boolean;
}

export interface UseScrollableListOpts {
  readonly total: number;
  /** Default 15 — visible row count. */
  readonly windowSize?: number;
  /** Called when the user presses Esc. */
  readonly onClose?: () => void;
  /** Called when the user presses Enter on the active row. */
  readonly onSelect?: (index: number) => void;
  /** Disable key handling (e.g. when a parent dialog wants the keys). */
  readonly isActive?: boolean;
}

/**
 * Drives ↑↓ / PgUp / PgDn / Home / End navigation over a list and
 * keeps the visible window scrolled to the cursor. Consumers slice
 * their items by `[offset, offset + windowSize)` and render the row
 * matching `cursor` as focused.
 */
export function useScrollableList({
  total,
  windowSize = 15,
  onClose,
  onSelect,
  isActive = true,
}: UseScrollableListOpts): ScrollableListResult {
  const [cursor, setCursor] = useState(0);
  const [offset, setOffset] = useState(0);

  // Keep cursor / offset in range when the total shrinks (e.g. after
  // search filtering or live skill reloads).
  useEffect(() => {
    if (cursor >= total) setCursor(Math.max(0, total - 1));
    if (offset > Math.max(0, total - windowSize)) {
      setOffset(Math.max(0, total - windowSize));
    }
  }, [total, windowSize, cursor, offset]);

  useInput(
    (input, key) => {
      if (key.escape && onClose) {
        onClose();
        return;
      }
      if (key.return && onSelect) {
        onSelect(cursor);
        return;
      }
      let nextCursor = cursor;
      if (key.upArrow) nextCursor = Math.max(0, cursor - 1);
      else if (key.downArrow) nextCursor = Math.min(total - 1, cursor + 1);
      else if (key.pageUp) nextCursor = Math.max(0, cursor - windowSize);
      else if (key.pageDown) nextCursor = Math.min(total - 1, cursor + windowSize);
      else if (input === 'g') nextCursor = 0;
      else if (input === 'G') nextCursor = total - 1;
      else return;

      setCursor(nextCursor);
      // Scroll the window to keep `nextCursor` in view.
      if (nextCursor < offset) setOffset(nextCursor);
      else if (nextCursor >= offset + windowSize) {
        setOffset(nextCursor - windowSize + 1);
      }
    },
    { isActive },
  );

  return {
    offset,
    windowSize,
    cursor,
    total,
    visible: { start: offset, end: Math.min(total, offset + windowSize) },
    canScrollUp: offset > 0,
    canScrollDown: offset + windowSize < total,
  };
}
