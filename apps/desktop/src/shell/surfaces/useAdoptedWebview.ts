import { useEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';

/** What the pane calls on an Electron `<webview>` element. */
export interface WebviewElement extends HTMLElement {
  getWebContentsId(): number;
  getURL(): string;
  goBack(): void;
  goForward(): void;
  reload(): void;
  loadURL(url: string): Promise<void>;
}

/**
 * One `<webview>`'s life: create it, hand it to main, keep its address in
 * sync, and give it back on unmount.
 *
 * Adoption cannot happen before `dom-ready` — there is no webContents to hand
 * over until Chromium has actually built the view. Everything downstream (the
 * agent's snapshot, its clicks, the tab strip) depends on main knowing about
 * this view, so the handshake is the whole job of this hook and it is kept
 * apart from the markup for exactly that reason.
 */
export function useAdoptedWebview(opts: {
  readonly ref: RefObject<WebviewElement | null>;
  readonly requestId?: string;
  readonly adopt: (webContentsId: number, requestId?: string) => Promise<string | null>;
  readonly release: (tabId: string) => Promise<void>;
}): { readonly tabId: string | null; readonly url: string } {
  const [tabId, setTabId] = useState<string | null>(null);
  const [url, setUrl] = useState('');
  // Held in a ref as well so the cleanup can release a tab adopted moments
  // before unmount, when React has already discarded the state update.
  const tabIdRef = useRef<string | null>(null);
  const { ref, requestId } = opts;
  /**
   * Callbacks live in a ref, and the effect depends only on the view itself.
   *
   * A caller almost always passes inline arrows, so `adopt`/`release` are new
   * objects on every render. With them in the dependency list the effect tore
   * down and re-ran each time — and its cleanup RELEASES the tab, so the view
   * was registered and released in a loop and main ended up with nothing.
   * Observed live as a permanently blank pane.
   */
  const handlers = useRef(opts);
  handlers.current = opts;

  useEffect(() => {
    const view = ref.current;
    if (!view) return;
    let disposed = false;

    const onReady = (): void => {
      if (disposed || tabIdRef.current) return;
      void handlers.current.adopt(view.getWebContentsId(), requestId).then((id) => {
        if (disposed || !id) return;
        tabIdRef.current = id;
        setTabId(id);
      });
    };
    const onNavigated = (): void => {
      if (!disposed) setUrl(view.getURL());
    };

    view.addEventListener('dom-ready', onReady);
    view.addEventListener('did-navigate', onNavigated);
    view.addEventListener('did-navigate-in-page', onNavigated);
    view.addEventListener('page-title-updated', onNavigated);

    return () => {
      disposed = true;
      view.removeEventListener('dom-ready', onReady);
      view.removeEventListener('did-navigate', onNavigated);
      view.removeEventListener('did-navigate-in-page', onNavigated);
      view.removeEventListener('page-title-updated', onNavigated);
      const id = tabIdRef.current;
      if (id) void handlers.current.release(id);
    };
    // Only the view and its request id identify this attachment; the callbacks
    // are read through the ref above so a re-render cannot restart the effect.
  }, [ref, requestId]);

  return { tabId, url };
}
