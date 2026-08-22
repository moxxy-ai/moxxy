import { useCallback, useRef, useState } from 'react';
import { api, toErrorMessage } from '@moxxy/client-core';
import { emitAttachment } from '@/shell/WorkspaceFiles';
import { normalizeAddress } from './useBrowserTabs';
import type { Rect } from './useRegionSelect';

/**
 * The chrome wrapped around the page: what the address bar reads, which tab the
 * buttons act on, and handing a picture of the page to the agent.
 *
 * Separate from {@link useBrowserTabs} because it is about this pane's own
 * moment-to-moment state rather than the tab set — and separate from the pane
 * so the pane is markup and nothing else. A test can drive all of it without an
 * Electron `<webview>`, which is not a thing a test can create.
 */
export interface BrowserChrome {
  /** What the address bar shows. */
  readonly address: string;
  /** The user typed: stop echoing the page until they submit or blur away. */
  readonly setAddress: (value: string) => void;
  /** True while the user's text owns the bar. */
  readonly editing: boolean;
  /** Go to whatever is in the bar. */
  readonly submitAddress: () => void;
  /** The view in front reporting its tab and URL. */
  readonly onViewState: (tabId: string | null, url: string) => void;
  /** Which tab the buttons act on. */
  readonly targetTab: () => string | undefined;
  /**
   * Photograph the page and hand it to the agent as an attachment. Pass a
   * rectangle to crop to it, or `null` to abandon a selection that was started.
   */
  readonly captureToAgent: (crop?: Rect | null) => Promise<void>;
  /** True while the person is drawing the rectangle to crop to. */
  readonly picking: boolean;
  /** Start drawing one. */
  readonly startPicking: () => void;
  /** Why the last capture did not happen, if it did not. */
  readonly captureError: string | null;
}

/**
 * A filename that says which page it is a picture of.
 *
 * The chip in the composer shows this, and a draft can hold several — "image
 * 3.png" three times over tells the person nothing about what they attached.
 */
export function screenshotName(url: string): string {
  try {
    const host = new URL(url).hostname.replace(/^www\./, '');
    return host ? `browser-${host}.png` : 'browser-screenshot.png';
  } catch {
    return 'browser-screenshot.png';
  }
}

export function useBrowserChrome(opts: {
  readonly activeTabId: string | null;
  readonly navigate: (url: string, tabId?: string) => Promise<void>;
}): BrowserChrome {
  const { activeTabId, navigate } = opts;
  const [address, setAddressState] = useState('');
  const [editing, setEditing] = useState(false);
  const [captureError, setCaptureError] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  /** The view currently in front, as it last reported itself. */
  const inFront = useRef<{ tabId: string | null; url: string }>({ tabId: null, url: '' });

  /**
   * Which tab the buttons act on. Main's `activeTabId` is authoritative — the
   * agent switches tabs too, and a locally-remembered id then names a tab that
   * is no longer in front (or, after a reload, one main never knew about, which
   * came back as "unknown tab_id t1").
   */
  const targetTab = useCallback(
    (): string | undefined => activeTabId ?? inFront.current.tabId ?? undefined,
    [activeTabId],
  );

  // Read inside onViewState, which the view calls on every render it is in
  // front for — a stale closure there would echo the page over live typing.
  const editingRef = useRef(false);
  editingRef.current = editing;

  const onViewState = useCallback((tabId: string | null, url: string): void => {
    inFront.current = { tabId, url };
    // Never while typing: the page would yank the caret out of the user's hands.
    setAddressState((prev) => (url && !editingRef.current && url !== prev ? url : prev));
  }, []);

  const setAddress = useCallback((value: string): void => {
    setAddressState(value);
    setEditing(true);
  }, []);

  const submitAddress = useCallback((): void => {
    setEditing(false);
    const url = normalizeAddress(address);
    if (url) void navigate(url, targetTab());
  }, [address, navigate, targetTab]);

  /**
   * Take the picture, then send it the same way a pasted screenshot goes: main
   * writes the bytes to a temp file and answers with an attachment, which the
   * Composer picks up off the shared event. Riding that pipeline rather than
   * inventing one is also what clears the attachment provenance gate — a path
   * the renderer conjured up on its own would be dropped before the turn.
   */
  const captureToAgent = useCallback(async (crop?: Rect | null): Promise<void> => {
    setCaptureError(null);
    // `null` is the person changing their mind mid-selection: leave the mode,
    // send nothing. `undefined` is the plain "whole view" button.
    setPicking(false);
    if (crop === null) return;
    try {
      const tabId = targetTab();
      const shot = await api().invoke('browser.capture', {
        ...(tabId ? { tabId } : {}),
        ...(crop ? { clip: crop } : {}),
      });
      const saved = await api().invoke('session.saveImageAttachment', {
        dataBase64: shot.base64,
        mediaType: shot.mediaType,
        name: screenshotName(inFront.current.url),
      });
      emitAttachment(saved);
    } catch (err) {
      setCaptureError(toErrorMessage(err));
    }
  }, [targetTab]);

  return {
    address,
    setAddress,
    editing,
    submitAddress,
    onViewState,
    targetTab,
    captureToAgent,
    captureError,
    picking,
    startPicking: () => setPicking(true),
  };
}
