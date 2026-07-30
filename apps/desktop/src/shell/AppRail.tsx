import { Icon, type IconName } from '@moxxy/desktop-ui';
import { MoxxyMark } from '@/components/MoxxyMark';
import { ProfilePill } from './workspace-sidebar/ProfilePill';
import { toggleRailExpanded, useRailExpanded } from '@/lib/useRailExpanded';
import type { View } from './views';

/**
 * The app rail: ONE navigation organ, 52px wide, always visible.
 *
 * This replaces a split that had the same decision living in two places — a
 * segmented pill in the main-pane header carried Chat / Collaborate / Apps
 * while Mobile and Settings sat at the bottom of the workspace sidebar. A user
 * had to know which of the two organs owned the destination they wanted.
 *
 * The rail is also the vertical strap of the Harness weave: it paints ABOVE the
 * 44px horizontal band formed by the index head and the instrument bar, and the
 * active item's 2px commanded strap runs the full row height and passes UNDER
 * that band's seam (see `.rail-item[data-active]::after` in styles.css).
 *
 * Destinations are grouped by what they are, not alphabetically: the four
 * places work happens, then Channels (how work reaches you), then Settings and
 * the account at the foot. Labels are ONE word wherever the language allows —
 * a tooltip is a label, not a sentence.
 *
 * Icon-only is the default because the rail is permanent chrome and 52px is the
 * point — but an icon-only rail is unreadable on first contact, and a tooltip
 * only helps someone who already suspects there is something to hover. So the
 * rail expands to a labelled column (the button at its foot, persisted via
 * {@link useRailExpanded}): read the five destinations once, then keep it or
 * fold it back. Every item carries its name in the accessibility tree either
 * way, so a screen reader never depends on the expanded state.
 */

interface Destination {
  readonly id: View;
  readonly icon: IconName;
  readonly label: string;
}

const DESTINATIONS: ReadonlyArray<Destination> = [
  // The id stays `chat`: the whole surface behind it is still `src/chat` and the
  // chat store, and renaming the id but not the module would be less coherent,
  // not more. "Runs" is the user-facing name for what it shows.
  { id: 'chat', icon: 'chat', label: 'Runs' },
  { id: 'collaborate', icon: 'agent', label: 'Collaborate' },
  { id: 'automations', icon: 'workflow', label: 'Automations' },
  { id: 'apps', icon: 'grid', label: 'Apps' },
  { id: 'channels', icon: 'broadcast', label: 'Channels' },
];

export function AppRail({
  view,
  onView,
  disabledViews,
  disabledReason,
}: {
  readonly view: View;
  readonly onView: (v: View) => void;
  readonly disabledViews?: ReadonlyArray<View>;
  readonly disabledReason?: string;
}): JSX.Element {
  const expanded = useRailExpanded();
  const isDisabled = (id: View): boolean => disabledViews?.includes(id) ?? false;
  return (
    <nav className="app-rail" data-expanded={expanded} aria-label="Main">
      <span className="app-rail__mark" aria-hidden>
        <MoxxyMark size={24} />
      </span>
      {DESTINATIONS.map((d) => (
        <RailItem
          key={d.id}
          destination={d}
          active={view === d.id}
          expanded={expanded}
          disabled={isDisabled(d.id)}
          disabledReason={disabledReason}
          onClick={() => onView(d.id)}
        />
      ))}
      <span className="app-rail__spacer" />
      <RailItem
        destination={{ id: 'mobile', icon: 'smartphone', label: 'Mobile' }}
        active={view === 'mobile'}
        expanded={expanded}
        disabled={isDisabled('mobile')}
        disabledReason={disabledReason}
        onClick={() => onView('mobile')}
      />
      <RailItem
        destination={{
          id: 'settings',
          icon: 'settings',
          label: 'Settings',
        }}
        active={view === 'settings'}
        expanded={expanded}
        disabled={isDisabled('settings')}
        disabledReason={disabledReason}
        onClick={() => onView('settings')}
      />
      <button
        type="button"
        className="rail-item rail-item--toggle tip"
        data-testid="rail-expand"
        data-tip={expanded ? 'Hide labels' : 'Show labels'}
        aria-expanded={expanded}
        aria-label={expanded ? 'Hide navigation labels' : 'Show navigation labels'}
        onClick={toggleRailExpanded}
      >
        <span className="rail-item__glyph" data-flip={expanded}>
          <Icon name="chevron-right" size={16} />
        </span>
        {expanded && <span className="rail-item__label">Hide labels</span>}
      </button>
      {/* The account row keeps its own Clerk-aware states (sign in / profile);
       *  in the rail it renders as the avatar tile only. */}
      <ProfilePill compact />
    </nav>
  );
}

function RailItem({
  destination,
  active,
  expanded,
  disabled,
  disabledReason,
  onClick,
}: {
  readonly destination: Destination;
  readonly active: boolean;
  readonly expanded: boolean;
  readonly disabled: boolean;
  readonly disabledReason?: string;
  readonly onClick: () => void;
}): JSX.Element {
  return (
    <button
      type="button"
      className="rail-item tip"
      // Kept from the old header pill so existing navigation tests, which pick
      // destinations by `nav-<id>`, keep addressing the same control.
      data-testid={`nav-${destination.id}`}
      data-active={active}
      // Not `title`: the OS tooltip takes over a second to appear and cannot be
      // styled, which makes an icon-only rail read as unlabelled. See `.tip`.
      data-tip={disabled ? disabledReason : destination.label}
      aria-current={active ? 'page' : undefined}
      aria-disabled={disabled || undefined}
      disabled={disabled}
      onClick={onClick}
    >
      <span className="rail-item__glyph">
        <Icon name={destination.icon} size={17} />
      </span>
      {/* The name is in the accessibility tree in BOTH states: visible text when
       *  expanded, screen-reader-only when compact. */}
      {expanded ? (
        <span className="rail-item__label">{destination.label}</span>
      ) : (
        <span className="sr-only">{destination.label}</span>
      )}
    </button>
  );
}
