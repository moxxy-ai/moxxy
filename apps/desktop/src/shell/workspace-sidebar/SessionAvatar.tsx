import type { CSSProperties } from 'react';
import { sessionAvatar } from './session-avatar';

/** What a run is doing, drawn on the corner of its avatar. */
export type AvatarBadge = 'working' | 'unread';

const BADGE_LABEL: Record<AvatarBadge, string> = {
  working: 'working',
  unread: 'unread activity',
};

/** A run's avatar: a tinted disc with the first letter of its name. */
export function SessionAvatar({
  id,
  name,
  size = 'row',
  badge = null,
}: {
  readonly id: string;
  readonly name: string;
  /** `row` in the list, `bar` in the header. */
  readonly size?: 'row' | 'bar';
  readonly badge?: AvatarBadge | null;
}): JSX.Element {
  const { hue, glyph } = sessionAvatar(id, name);
  return (
    <span
      className="avatar"
      data-size={size}
      data-testid="session-avatar"
      style={{ '--avatar-hue': hue } as CSSProperties}
    >
      <span aria-hidden>{glyph}</span>
      {badge && (
        <span
          className="avatar__badge"
          data-state={badge}
          role="img"
          aria-label={BADGE_LABEL[badge]}
        />
      )}
    </span>
  );
}
