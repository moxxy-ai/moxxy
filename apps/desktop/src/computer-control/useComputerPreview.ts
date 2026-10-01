import { useEffect, useState } from 'react';
import { useSurface } from '../shell/surfaces/useSurface';
import {
  applyPreview, COMPUTER_PREVIEW_SURFACE, hidePreview, showPreview, STOPPED_PREVIEW, usePreviewHidden, type HideScope, type PreviewView,
} from './preview-model';

/**
 * The live picture of the app a turn is working in. The surface is open only
 * while `active` and not hidden, and the helper captures only while it is open.
 */
export function useComputerPreview(workspaceId: string, active: boolean) {
  const hidden = usePreviewHidden(workspaceId);
  const watching = active && !hidden;
  const [view, setView] = useState<PreviewView>(STOPPED_PREVIEW);
  useEffect(() => { setView(STOPPED_PREVIEW); }, [workspaceId, watching]);
  const surface = useSurface(watching ? workspaceId : null, COMPUTER_PREVIEW_SURFACE, {
    onSnapshot: (snapshot) => setView((current) => applyPreview(current, snapshot)),
    onData: (payload) => setView((current) => applyPreview(current, payload)),
  });
  return {
    view: watching && surface.ready ? view : null,
    hidden,
    hide: (scope: HideScope) => hidePreview(scope, workspaceId),
    show: () => showPreview(workspaceId),
  };
}
