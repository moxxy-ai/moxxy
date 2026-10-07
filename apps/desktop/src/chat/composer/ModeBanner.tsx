import type { ModeBadge } from '@/chat/agent-picker/types';

/**
 * Shown in the composer while a badged mode is active (goal mode today), so it
 * is always plain that the agent is driving itself. Driven by the badge the
 * mode advertises, so a future autonomous mode lights it without a change here.
 */
export function ModeBanner({ badge }: { readonly badge: ModeBadge }): JSX.Element {
  return (
    <div className="mode-banner" role="status" data-testid="mode-banner" data-tone={badge.tone}>
      <span className="mode-banner__badge" aria-hidden>
        {badge.label}
      </span>
      <span>
        {badge.label} mode active — the agent keeps working autonomously toward your
        objective.
      </span>
    </div>
  );
}
