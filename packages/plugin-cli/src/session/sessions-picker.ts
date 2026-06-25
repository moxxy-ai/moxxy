import type { SessionMeta } from '@moxxy/core';
import type { ClientSession as Session } from '@moxxy/sdk';
import type { ListPickerOption } from '../components/ListPicker.js';

/**
 * What the TUI asks the host to switch to. `{ kind: 'new' }` boots a fresh
 * session (empty log); `{ kind: 'resume', id }` re-bootstraps the host onto the
 * persisted session with that id (seeding its event log from disk).
 */
export type SessionSwitchTarget = { kind: 'new' } | { kind: 'resume'; id: string };

/**
 * Host-provided capability the TUI calls when the user picks an entry in the
 * `/sessions` switcher. The host owns the heavy lifting (closing the live
 * session, re-pointing the runner socket, booting the new one) and resolves with
 * the new `Session` the view should re-mount onto. Rejecting leaves the current
 * session in place (the switcher surfaces the error as a notice).
 *
 * Absent on transports that can't re-bootstrap in place (e.g. a thin client
 * attached to an external `moxxy serve`, whose runner owns a single fixed
 * session) — there the switcher degrades to an explanatory notice.
 */
export type SwitchSession = (target: SessionSwitchTarget) => Promise<Session>;

/** Synthetic option id for the "start a new session" entry. */
export const NEW_SESSION_OPTION_ID = '__new__';

/** Max chars of a first-prompt title shown in the picker row. */
const TITLE_MAX = 60;

/**
 * Build the `ListPicker` options for the `/sessions` switcher from the persisted
 * session index. Pure (no I/O) so it's unit-testable: the caller passes the
 * already-read `SessionMeta[]` (newest-first, the order `readSessionIndex`
 * returns) plus the id of the session the TUI is currently driving.
 *
 *  - The active session is marked `current` and badged `active` so it's obvious
 *    which conversation you're in.
 *  - Empty sessions (0 events, no first prompt) are dropped as noise — they're
 *    the throwaway probe/boot artifacts the resume picker also hides, EXCEPT the
 *    active one, which is always shown even when brand-new so the user can see
 *    where they are.
 *  - A leading "+ New session" entry boots a fresh conversation.
 */
export function buildSessionPickerOptions(
  metas: ReadonlyArray<SessionMeta>,
  activeId: string,
  now: number = Date.now(),
): ListPickerOption[] {
  const options: ListPickerOption[] = [
    {
      id: NEW_SESSION_OPTION_ID,
      label: '+ New session',
      description: 'start a fresh conversation (the current one stays saved)',
    },
  ];
  for (const m of metas) {
    const isActive = m.id === activeId;
    // Drop empty non-active sessions: a session with no first prompt and no
    // events is a boot artifact, not something the user wants to resume.
    if (!isActive && (m.firstPrompt == null || m.firstPrompt.trim() === '') && m.eventCount === 0) {
      continue;
    }
    options.push({
      id: m.id,
      label: titleFor(m),
      description: describe(m, now),
      ...(isActive ? { current: true, badge: 'active', badgeColor: 'green' as const } : {}),
    });
  }
  return options;
}

function titleFor(m: SessionMeta): string {
  const raw = m.title?.trim() || m.firstPrompt?.trim();
  if (!raw) return '(empty session)';
  const oneLine = raw.replace(/\s+/g, ' ');
  return oneLine.length > TITLE_MAX ? `${oneLine.slice(0, TITLE_MAX - 1)}…` : oneLine;
}

function describe(m: SessionMeta, now: number): string {
  const when = formatAgo(m.lastActivity, now);
  const events = `${m.eventCount} ev`;
  const provider = m.model ?? m.provider;
  return provider ? `${when} · ${events} · ${provider}` : `${when} · ${events}`;
}

/** Compact "Ns/Nm/Nh/Nd ago" — mirrors the `moxxy sessions list` formatting. */
export function formatAgo(iso: string, now: number = Date.now()): string {
  const then = Date.parse(iso);
  if (!Number.isFinite(then)) return iso;
  const diffSec = Math.max(0, Math.floor((now - then) / 1000));
  if (diffSec < 60) return `${diffSec}s ago`;
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`;
  if (diffSec < 86_400) return `${Math.floor(diffSec / 3600)}h ago`;
  return `${Math.floor(diffSec / 86_400)}d ago`;
}
