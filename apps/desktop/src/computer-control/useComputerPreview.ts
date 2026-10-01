import { useCallback, useEffect, useRef, useState } from 'react';
import { useSurface } from '../shell/surfaces/useSurface';
import {
  applyPreview, COMPUTER_PREVIEW_SURFACE, hidePreview, showPreview, STOPPED_PREVIEW, usePreviewHidden, type HideScope, type PreviewView,
} from './preview-model';
import { asVideoChunk, browserVideoCodecs, createVideoPainter, type VideoCodecs, type VideoPainter } from './video-preview';

/**
 * The live picture of the app a turn is working in. The surface is open only
 * while `active` and not hidden, and the helper captures only while it is open.
 * Where the browser can decode video the surface is asked for an H.264 stream;
 * otherwise it sends JPEG frames.
 */
export function useComputerPreview(workspaceId: string, active: boolean, codecs: VideoCodecs | null = browserVideoCodecs()) {
  const hidden = usePreviewHidden(workspaceId);
  const watching = active && !hidden;
  const [view, setView] = useState<PreviewView>(STOPPED_PREVIEW);
  useEffect(() => { setView(STOPPED_PREVIEW); }, [workspaceId, watching]);
  const painter = useRef<VideoPainter | null>(null);
  const canvas = useRef<HTMLCanvasElement | null>(null);
  const surface = useSurface(watching ? workspaceId : null, COMPUTER_PREVIEW_SURFACE, {
    onSnapshot: (snapshot) => setView((current) => applyPreview(current, snapshot)),
    onData: (payload) => {
      const chunk = asVideoChunk(payload);
      if (chunk) painter.current?.push(chunk);
      setView((current) => applyPreview(current, payload));
    },
  });
  // `input` is a new function on every render; the effects below must not follow it.
  const input = useRef(surface.input);
  input.current = surface.input;
  const video = watching && surface.ready && codecs !== null;
  useEffect(() => {
    if (!video || !codecs) return;
    const created = createVideoPainter(codecs, () => input.current({ type: 'keyframe' }));
    created.canvas(canvas.current);
    painter.current = created;
    input.current({ type: 'configure', codecs: ['h264', 'jpeg'] });
    return () => { painter.current = null; created.close(); };
  }, [video, codecs, workspaceId]);
  const videoCanvas = useCallback((element: HTMLCanvasElement | null) => {
    canvas.current = element;
    painter.current?.canvas(element);
  }, []);
  return {
    view: watching && surface.ready ? view : null,
    hidden,
    hide: (scope: HideScope) => hidePreview(scope, workspaceId),
    show: () => showPreview(workspaceId),
    videoCanvas,
  };
}
