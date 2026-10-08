/**
 * The launch banner's state: whether a new Moxxy is on offer, and what its one
 * button does. The update itself — its steps, its progress, its restart — is
 * shown by the installer screen (`update/`), so the banner steps aside for it.
 */

import { useCallback, useState } from 'react';
import { api, useAppUpdate } from '@moxxy/client-core';

export interface UpdateBannerView {
  /** Why the last try did not finish; shown beside the offer. */
  readonly error: string | null;
  readonly actionLabel: 'Update' | 'Try again';
  readonly onUpdate: () => void;
  /** Opens the release page, when the installer could not be fetched. */
  readonly onGetManually: (() => void) | null;
  readonly onDismiss: () => void;
}

export function useUpdateBanner(): UpdateBannerView | null {
  const { check, state, error, runUpdateAll } = useAppUpdate({ autoCheck: true });
  const [dismissed, setDismissed] = useState(false);
  const onUpdate = useCallback(() => void runUpdateAll(), [runUpdateAll]);
  const onDismiss = useCallback(() => setDismissed(true), []);
  const releaseUrl = check?.releaseUrl;
  const openRelease = useCallback(() => {
    if (releaseUrl) void api().invoke('onboarding.openExternal', { url: releaseUrl });
  }, [releaseUrl]);

  const offered = state === 'available' || state === 'incompatible' || state === 'requires-full-update';
  if (dismissed || !(offered || state === 'error')) return null;
  return {
    error,
    actionLabel: state === 'error' ? 'Try again' : 'Update',
    onUpdate,
    onGetManually: state === 'requires-full-update' && error && releaseUrl ? openRelease : null,
    onDismiss,
  };
}
