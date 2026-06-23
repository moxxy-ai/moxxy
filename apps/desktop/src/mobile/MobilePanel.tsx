/**
 * Mobile view — a top-level sidebar destination (above Settings) that hosts the
 * mobile-gateway pairing surface.
 *
 * Previously this lived as a tab inside Settings. It was promoted to its own
 * sidebar entry because the gateway is a stateful, on-demand service (start it,
 * pair a phone, stop it) rather than a static preference — surfacing it at the
 * top level keeps it one click away and out of the Settings tab churn.
 *
 * The panel is pure chrome: the {@link MobileTab} body owns all gateway state
 * (enable toggle, QR, regenerate) via `useMobileGateway`. Unlike Workflows /
 * Apps, this view does NOT depend on the runner session (the gateway lifecycle
 * is main-process-side), so it is never runner-locked.
 */

import { MobileTab } from '../settings/MobileTab';
import { ViewHeader, ViewSwitcher, type View } from '../shell/ViewHeader';

export function MobilePanel({
  // Optional so the panel can render standalone (tests); the app shell always
  // wires it so the header switcher navigates back to Chat/Workflows/etc.
  onView = () => undefined,
  disabledViews,
  disabledViewReason,
}: {
  readonly onView?: (v: View) => void;
  readonly disabledViews?: ReadonlyArray<View>;
  readonly disabledViewReason?: string;
}): JSX.Element {
  return (
    <>
      <ViewHeader>
        <ViewSwitcher
          view="mobile"
          onView={onView}
          disabledViews={disabledViews}
          disabledReason={disabledViewReason}
        />
        <span style={{ flex: 1 }} />
        <span style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--color-text-muted)' }}>
          Mobile
        </span>
      </ViewHeader>
      <div
        style={{
          flex: 1,
          minHeight: 0,
          overflowY: 'auto',
          padding: '20px 32px 40px',
          display: 'flex',
          flexDirection: 'column',
          gap: 20,
        }}
      >
        <MobileTab />
      </div>
    </>
  );
}
