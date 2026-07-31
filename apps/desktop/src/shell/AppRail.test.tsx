import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { __setApiOverride } from '@moxxy/client-core';
import type { MoxxyApi } from '@moxxy/desktop-ipc-contract';
import { MoxxyMark } from '@/components/MoxxyMark';
import { reloadRailExpandedFromStorage } from '@/lib/useRailExpanded';
import { AppRail } from './AppRail';

vi.mock('./workspace-sidebar/ProfilePill', () => ({
  ProfilePill: () => <span data-testid="profile-pill" />,
}));

/**
 * The app rail is the app's ONLY navigation organ, and it is icon-only by
 * default. Both of those make it easy to ship something unusable, so what is
 * pinned here is discoverability rather than layout: every destination is
 * reachable, named, and labelable.
 */

beforeEach(() => {
  window.localStorage.clear();
  reloadRailExpandedFromStorage();
  // The rail's account tile reads prefs, so the transport has to exist.
  __setApiOverride({
    invoke: vi.fn(async () => ({})),
    subscribe: () => () => undefined,
  } as unknown as MoxxyApi);
});

afterEach(() => __setApiOverride(null));

const DESTINATIONS = [
  ['chat', 'Runs'],
  ['collaborate', 'Collaborate'],
  ['automations', 'Automations'],
  ['apps', 'Apps'],
  ['channels', 'Channels'],
  ['settings', 'Settings'],
] as const;

describe('AppRail', () => {
  it('carries every destination, each with an accessible name while icon-only', () => {
    render(<AppRail view="chat" onView={vi.fn()} />);
    for (const [id, label] of DESTINATIONS) {
      const item = screen.getByTestId(`nav-${id}`);
      // The name is in the tree even when no text is painted, so a screen-reader
      // user never depends on the rail being expanded.
      expect(item, `nav-${id} missing`).toBeTruthy();
      expect(item.textContent).toContain(label);
    }
  });

  it('marks exactly one destination active, and it is the current view', () => {
    render(<AppRail view="automations" onView={vi.fn()} />);
    const active = DESTINATIONS.filter(
      ([id]) => screen.getByTestId(`nav-${id}`).getAttribute('data-active') === 'true',
    );
    expect(active.map(([id]) => id)).toEqual(['automations']);
    expect(screen.getByTestId('nav-automations')).toHaveAttribute('aria-current', 'page');
  });

  it('navigates on click', () => {
    const onView = vi.fn();
    render(<AppRail view="chat" onView={onView} />);
    fireEvent.click(screen.getByTestId('nav-channels'));
    expect(onView).toHaveBeenCalledWith('channels');
  });

  it('does not navigate from a runner-locked destination', () => {
    const onView = vi.fn();
    render(
      <AppRail
        view="chat"
        onView={onView}
        disabledViews={['automations']}
        disabledReason="Moxxy is still loading this session"
      />,
    );
    const locked = screen.getByTestId('nav-automations');
    expect(locked).toBeDisabled();
    expect(locked).toHaveAttribute('data-tip', 'Moxxy is still loading this session');
    fireEvent.click(locked);
    expect(onView).not.toHaveBeenCalled();
  });

  it('labels destinations with data-tip, never the native title attribute', () => {
    render(<AppRail view="chat" onView={vi.fn()} />);
    for (const [id, label] of DESTINATIONS) {
      const item = screen.getByTestId(`nav-${id}`);
      // `title` is the bug being prevented: the OS tooltip takes over a second
      // to appear and cannot be styled, which leaves an icon rail effectively
      // unlabelled for a pointer user. `.tip` renders in 140ms instead.
      expect(item.getAttribute('title'), `nav-${id} still uses a native title`).toBeNull();
      expect(item.getAttribute('data-tip')).toBe(label);
      expect(item.className).toContain('tip');
    }
  });

  it('expands to visible labels, and remembers the choice', () => {
    const { unmount } = render(<AppRail view="chat" onView={vi.fn()} />);
    const rail = screen.getByRole('navigation', { name: 'Main' });
    expect(rail).toHaveAttribute('data-expanded', 'false');

    fireEvent.click(screen.getByTestId('rail-expand'));
    expect(screen.getByRole('navigation', { name: 'Main' })).toHaveAttribute(
      'data-expanded',
      'true',
    );

    // Persisted, so a user who opened it once to read the destinations does not
    // have to re-open it on the next launch.
    unmount();
    reloadRailExpandedFromStorage();
    render(<AppRail view="chat" onView={vi.fn()} />);
    expect(screen.getByRole('navigation', { name: 'Main' })).toHaveAttribute(
      'data-expanded',
      'true',
    );
  });

  it('uses a one-line MoxxyAI wordmark without the old Workspaces subtitle', () => {
    render(<AppRail view="chat" onView={vi.fn()} />);
    fireEvent.click(screen.getByTestId('rail-expand'));

    const rail = screen.getByRole('navigation', { name: 'Main' });
    expect(rail).toHaveTextContent('MoxxyAI');
    expect(rail).not.toHaveTextContent('Workspaces');
  });
});

describe('MoxxyMark', () => {
  it('draws its two strands in DIFFERENT colours', () => {
    // The interlace is carried entirely by the colour change at each crossing,
    // so one hue for both strands collapses the mark into a solid eight-pointed
    // rosette. That is not hypothetical: the rail set `color` to the accent,
    // which matched the second strand exactly, and the mark stopped being the
    // mark. The ink strand must stay inheritable and the other must not.
    const { container } = render(
      <span style={{ color: 'var(--color-sidebar-text)' }}>
        <MoxxyMark size={24} />
      </span>,
    );
    const strokes = [...container.querySelectorAll('g[stroke]')].map((g) =>
      g.getAttribute('stroke'),
    );
    expect(strokes).toContain('currentColor');
    expect(strokes).toContain('var(--color-primary)');
    expect(new Set(strokes).size).toBeGreaterThan(1);
  });
});
