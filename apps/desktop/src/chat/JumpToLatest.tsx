/**
 * Floating "jump to latest" affordance for the transcript.
 *
 * Shown while the user has scrolled away from the bottom; clicking it asks
 * the transcript to scroll back down, which flips Virtuoso's `atBottom`
 * back on and resumes stick-to-bottom (`followOutput`). A primary-coloured
 * dot marks that NEW content (a committed row or streaming chunks) arrived
 * below the viewport since the user scrolled up.
 */
import { useEffect, useRef, useState } from 'react';
import { Icon, IconButton } from '@moxxy/desktop-ui';

/**
 * Tracks whether content was appended below the viewport while the user is
 * scrolled up. `contentKey` must change whenever content is APPENDED (last
 * row key / streaming length) but stay stable across upward-pagination
 * prepends, so paging older history in never fakes an unread hint.
 */
export function useNewContentBelow(atBottom: boolean, contentKey: string): boolean {
  const [unread, setUnread] = useState(false);
  const prev = useRef(contentKey);
  useEffect(() => {
    if (atBottom) {
      prev.current = contentKey;
      setUnread(false);
      return;
    }
    if (contentKey !== prev.current) {
      prev.current = contentKey;
      setUnread(true);
    }
  }, [atBottom, contentKey]);
  return unread;
}

interface JumpToLatestProps {
  /** True when the user is scrolled away from the bottom. */
  readonly visible: boolean;
  /** True when new content arrived below while scrolled up. */
  readonly unread: boolean;
  readonly onJump: () => void;
}

export function JumpToLatest({ visible, unread, onJump }: JumpToLatestProps): JSX.Element | null {
  if (!visible) return null;
  return (
    <IconButton
      bordered
      size={36}
      radius={999}
      aria-label="Scroll to latest"
      data-testid="scroll-to-bottom"
      onClick={onJump}
      style={{
        position: 'absolute',
        left: '50%',
        bottom: 16,
        transform: 'translateX(-50%)',
        zIndex: 5,
        boxShadow: 'var(--color-card-shadow)',
        color: 'var(--color-text)',
      }}
    >
      {/* The icon set has no chevron-down/arrow-down glyph — reuse the
       *  existing chevron rotated a quarter turn. */}
      <Icon name="chevron-right" size={18} style={{ transform: 'rotate(90deg)' }} />
      {unread && (
        <span
          data-testid="scroll-to-bottom-unread"
          style={{
            position: 'absolute',
            top: 1,
            right: 1,
            width: 8,
            height: 8,
            borderRadius: 999,
            background: 'var(--color-primary)',
          }}
        />
      )}
    </IconButton>
  );
}
