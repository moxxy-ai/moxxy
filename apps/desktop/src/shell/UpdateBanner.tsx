/**
 * Top-of-window banner that offers the update found by the launch check. It is
 * the update people who aren't technical see, so it asks nothing: one "Update"
 * installs the new Moxxy and restarts onto it, on the installer screen. A
 * failure says Moxxy still works and offers another try. It can be dismissed.
 */

import { Button } from '@moxxy/desktop-ui';
import { useUpdateBanner, type UpdateBannerView } from './useUpdateBanner';

export function UpdateBannerView({ error, actionLabel, onUpdate, onGetManually, onDismiss }: UpdateBannerView): JSX.Element {
  return (
    <div role="status" className="update-banner">
      {error ? <span className="update-banner__error">{error}</span> : <span>A Moxxy update is available.</span>}
      <Button variant="cta" className="update-banner__action" onClick={onUpdate}>
        {actionLabel}
      </Button>
      {onGetManually && (
        <Button variant="cta" className="update-banner__action" onClick={onGetManually}>
          Get it manually
        </Button>
      )}
      <button type="button" aria-label="Dismiss" className="update-banner__dismiss" onClick={onDismiss}>
        ✕
      </button>
    </div>
  );
}

export function UpdateBanner(): JSX.Element | null {
  const view = useUpdateBanner();
  return view ? <UpdateBannerView {...view} /> : null;
}
