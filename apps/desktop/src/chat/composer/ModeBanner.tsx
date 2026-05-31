/**
 * Persistent banner shown at the top of the composer while a "badged" mode
 * is active (currently goal mode). It's the most prominent of the desktop's
 * goal-mode signals — a full-width accent strip the user can't miss, so they
 * always know the agent is driving itself. The Mode chip picks up a matching
 * accent; this strip explains what that state means.
 *
 * Driven entirely by the mode's advertised badge (label + tone), so any
 * future autonomous mode lights it up without touching this file.
 */

import type { ModeBadge } from '@/chat/agent-picker/types';

/** Palette per tone: attention = amber (autonomous, heads-up), info = the
 *  brand cyan accent for a quieter highlight. */
function toneStyle(tone: ModeBadge['tone']): {
  readonly accent: string;
  readonly soft: string;
} {
  if (tone === 'info') {
    return { accent: 'var(--color-accent-strong)', soft: 'rgba(34, 211, 238, 0.12)' };
  }
  return { accent: 'var(--color-amber)', soft: 'rgba(245, 158, 11, 0.13)' };
}

export function ModeBanner({ badge }: { readonly badge: ModeBadge }): JSX.Element {
  const { accent, soft } = toneStyle(badge.tone);
  return (
    <div
      role="status"
      data-testid="mode-banner"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '7px 10px',
        marginBottom: 6,
        fontSize: 12.5,
        color: 'var(--color-text)',
        background: soft,
        border: `1px solid ${accent}`,
        borderRadius: 9,
      }}
    >
      <span
        aria-hidden
        style={{
          flex: '0 0 auto',
          padding: '1px 7px',
          fontSize: 11,
          fontWeight: 700,
          letterSpacing: 0.4,
          color: '#fff',
          background: accent,
          borderRadius: 'var(--radius-pill)',
        }}
      >
        {badge.label}
      </span>
      <span>
        {badge.label} mode active — the agent keeps working autonomously toward your
        objective.
      </span>
    </div>
  );
}
