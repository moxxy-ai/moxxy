import { useState } from 'react';
import { Icon, type IconName } from '@moxxy/desktop-ui';
import { MoxxyMark } from '@/components/MoxxyMark';
import { ProfilePill } from './workspace-sidebar/ProfilePill';
import { requestVoiceCall } from '@/lib/voiceCallRequest';
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
 * The default rail is intentionally small: Runs, Extensions, and Settings.
 * Collaboration, automation, apps, channels, mobile, and voice stay available
 * behind More without presenting a fresh user with the whole framework.
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
  /* A `View` for a destination, or a bare id for an ACTION that lives in the
   * rail without owning the pane (Voice). Both are places you go from here, and
   * splitting them into two controls would put the same kind of decision in two
   * organs again. */
  readonly id: string;
  readonly icon: IconName;
  readonly label: string;
}

/** The destinations that DO own the pane; `id` narrows to a View for these. */
const DESTINATIONS: ReadonlyArray<Destination & { readonly id: View }> = [
  // The id stays `chat`: the whole surface behind it is still `src/chat` and the
  // chat store, and renaming the id but not the module would be less coherent,
  // not more. "Runs" is the user-facing name for what it shows.
  { id: 'chat', icon: 'chat', label: 'Runs' },
  { id: 'extensions', icon: 'plug', label: 'Extensions' },
];

const OPTIONAL_DESTINATIONS: ReadonlyArray<Destination & { readonly id: View }> = [
  { id: 'collaborate', icon: 'agent', label: 'Collaborate' },
  { id: 'automations', icon: 'workflow', label: 'Automations' },
  { id: 'apps', icon: 'grid', label: 'Apps' },
  { id: 'channels', icon: 'broadcast', label: 'Channels' },
  { id: 'mobile', icon: 'smartphone', label: 'Mobile' },
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
  const [moreOpen, setMoreOpen] = useState(false);
  const isDisabled = (id: View): boolean => disabledViews?.includes(id) ?? false;
  const optionalViewActive = OPTIONAL_DESTINATIONS.some((destination) => destination.id === view);
  const showOptional = moreOpen || optionalViewActive;
  return (
    <nav className="app-rail" data-expanded={expanded} aria-label="Main">
      <span className="app-rail__mark">
        <span className="app-rail__mark-glyph" aria-hidden>
          <MoxxyMark size={24} />
        </span>
        {/* The wordmark only exists at a width that can hold it; compact, the
         *  mark IS the wordmark. */}
        {expanded && (
          <span className="app-rail__word">
            <b>MoxxyAI</b>
          </span>
        )}
        {/* Beside the mark, because widening the rail is a property of the rail
         *  itself — under Settings it read as a seventh destination. */}
        <button
          type="button"
          className="rail-toggle tip"
          data-testid="rail-expand"
          data-tip={expanded ? 'Hide labels' : 'Show labels'}
          data-tip-side="right"
          aria-expanded={expanded}
          aria-label={expanded ? 'Hide navigation labels' : 'Show navigation labels'}
          onClick={toggleRailExpanded}
        >
          <span className="rail-item__glyph" data-flip={expanded}>
            <Icon name="chevron-right" size={14} />
          </span>
        </button>
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
      <RailItem
        destination={{ id: 'more', icon: 'more', label: 'More' }}
        active={optionalViewActive}
        expanded={expanded}
        disabled={false}
        onClick={() => setMoreOpen((open) => !open)}
      />
      {showOptional &&
        OPTIONAL_DESTINATIONS.map((d) => (
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
      {showOptional && (
        <RailItem
          destination={{ id: 'voice', icon: 'speaker', label: 'Voice' }}
          active={false}
          expanded={expanded}
          disabled={isDisabled('chat')}
          disabledReason={disabledReason}
          onClick={() => {
            onView('chat');
            requestVoiceCall();
          }}
        />
      )}
      <span className="app-rail__spacer" />
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
      {/* The account row keeps its own Clerk-aware states (sign in / profile).
       *  Expanded it shows who you are; compact it is the avatar tile alone. */}
      <ProfilePill compact={!expanded} />
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
