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
import { InstrumentBar } from '../shell/InstrumentBar';

/** Mobile pairing. `embedded` when the Channels surface owns the chrome above it,
 *  which is the only way it is reached now — it kept a standalone header for the
 *  brief window where it was still its own destination. */
export function MobilePanel({ embedded = false }: { readonly embedded?: boolean }): JSX.Element {
  return (
    <>
      {!embedded && <InstrumentBar crumbs={['Channels', 'Mobile']} />}
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
