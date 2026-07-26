import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from 'react';
import { api } from '@moxxy/client-core';
import type {
  NativeBrowserRect,
  NativeBrowserSnapshot,
  NativeBrowserTabSnapshot,
} from '@moxxy/desktop-ipc-contract';

import { emitInsertPath } from '../WorkspaceFiles';

const ZOOM_MIN = 0.25;
const ZOOM_MAX = 5;
const MIN_CAPTURE_SIZE = 6;

interface DragRect {
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
}

export interface NativeBrowserViewModel {
  readonly snapshot: NativeBrowserSnapshot | null;
  readonly activeTab: NativeBrowserTabSnapshot | null;
  readonly address: string;
  readonly error: string | null;
  readonly notice: string | null;
  readonly captureImage: string | null;
  readonly drag: DragRect | null;
  readonly hostRef: RefObject<HTMLDivElement>;
  readonly setAddress: (value: string) => void;
  readonly beginAddressEdit: () => void;
  readonly endAddressEdit: () => void;
  readonly navigate: () => void;
  readonly goBack: () => void;
  readonly goForward: () => void;
  readonly reload: () => void;
  readonly setZoom: (zoom: number) => void;
  readonly newTab: () => void;
  readonly selectTab: (tabId: string) => void;
  readonly closeTab: (tabId: string) => void;
  readonly startCapture: () => void;
  readonly cancelCapture: () => void;
  readonly stopAgentControl: () => void;
  readonly retry: () => void;
  readonly onCapturePointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void;
  readonly onCapturePointerMove: (event: ReactPointerEvent<HTMLDivElement>) => void;
  readonly onCapturePointerUp: (event: ReactPointerEvent<HTMLDivElement>) => void;
}

/** Owns the renderer half of native-browser orchestration. The corresponding
 * view is presentation-only; third-party page input never traverses React or
 * IPC because Electron delivers it directly to the overlaid WebContentsView. */
export function useNativeBrowser(workspaceId: string): NativeBrowserViewModel {
  const [snapshot, setSnapshot] = useState<NativeBrowserSnapshot | null>(null);
  const [address, setAddressState] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [captureImage, setCaptureImage] = useState<string | null>(null);
  const [drag, setDrag] = useState<DragRect | null>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const editingAddressRef = useRef(false);
  const generationRef = useRef(0);
  const captureTabIdRef = useRef<string | null>(null);
  const capturePendingRef = useRef(false);
  const noticeTimerRef = useRef(0);

  const activeTab = useMemo(() => {
    if (!snapshot) return null;
    return snapshot.tabs.find((tab) => tab.id === snapshot.activeTabId) ?? null;
  }, [snapshot]);

  const applySnapshot = useCallback((next: NativeBrowserSnapshot): void => {
    setSnapshot(next);
    if (editingAddressRef.current) return;
    const active = next.tabs.find((tab) => tab.id === next.activeTabId);
    if (active) setAddressState(active.url === 'about:blank' ? '' : active.url);
  }, []);

  const showError = useCallback((reason: unknown): void => {
    setError(errorMessage(reason));
  }, []);

  const showNotice = useCallback((message: string): void => {
    setNotice(message);
    if (noticeTimerRef.current) window.clearTimeout(noticeTimerRef.current);
    noticeTimerRef.current = window.setTimeout(() => {
      noticeTimerRef.current = 0;
      setNotice((current) => (current === message ? null : current));
    }, 4000);
  }, []);

  const open = useCallback(async (): Promise<void> => {
    const generation = generationRef.current;
    setError(null);
    try {
      const next = await api().invoke('nativeBrowser.open', { workspaceId });
      if (generation !== generationRef.current) return;
      applySnapshot(next);
    } catch (reason) {
      if (generation !== generationRef.current) return;
      showError(reason);
    }
  }, [applySnapshot, showError, workspaceId]);

  useEffect(() => {
    generationRef.current += 1;
    const generation = generationRef.current;
    const unsubscribe = api().subscribe('nativeBrowser.changed', (event) => {
      if (generation !== generationRef.current) return;
      if (event.workspaceId !== workspaceId) return;
      applySnapshot(event.snapshot);
    });
    void open();

    return () => {
      generationRef.current += 1;
      unsubscribe();
      const tabId = captureTabIdRef.current;
      captureTabIdRef.current = null;
      capturePendingRef.current = false;
      if (tabId) {
        void api()
          .invoke('nativeBrowser.endCapture', { workspaceId, tabId })
          .catch(() => undefined);
      }
      void api()
        .invoke('nativeBrowser.setVisible', { workspaceId, visible: false })
        .catch(() => undefined);
    };
  }, [applySnapshot, open, workspaceId]);

  useEffect(
    () => () => {
      if (noticeTimerRef.current) window.clearTimeout(noticeTimerRef.current);
    },
    [],
  );

  useLayoutEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let frame = 0;
    const sendBounds = (): void => {
      if (frame) return;
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        const rect = host.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) return;
        void api()
          .invoke('nativeBrowser.setBounds', {
            workspaceId,
            rect: {
              x: rect.left,
              y: rect.top,
              width: rect.width,
              height: rect.height,
            },
            rendererViewport: { width: window.innerWidth, height: window.innerHeight },
          })
          .catch(showError);
      });
    };

    sendBounds();
    window.addEventListener('resize', sendBounds);
    const observer =
      typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(sendBounds);
    observer?.observe(host);
    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      window.removeEventListener('resize', sendBounds);
      observer?.disconnect();
    };
  }, [showError, workspaceId]);

  const invokeTarget = useCallback(
    async (
      command: 'nativeBrowser.back' | 'nativeBrowser.forward' | 'nativeBrowser.reload',
    ): Promise<void> => {
      const tab = activeTab;
      if (!tab) return;
      setError(null);
      try {
        await api().invoke(command, { workspaceId, tabId: tab.id });
      } catch (reason) {
        showError(reason);
      }
    },
    [activeTab, showError, workspaceId],
  );

  const navigate = useCallback((): void => {
    const tab = activeTab;
    const url = normalizeAddress(address);
    if (!tab || !url) return;
    editingAddressRef.current = false;
    setAddressState(url);
    setError(null);
    void api()
      .invoke('nativeBrowser.navigate', { workspaceId, tabId: tab.id, url })
      .catch(showError);
  }, [activeTab, address, showError, workspaceId]);

  const setZoom = useCallback(
    (zoom: number): void => {
      const tab = activeTab;
      if (!tab) return;
      const bounded = clampZoom(zoom);
      setSnapshot((current) => patchTabZoom(current, tab.id, bounded));
      void api()
        .invoke('nativeBrowser.setZoom', { workspaceId, tabId: tab.id, zoom: bounded })
        .catch(showError);
    },
    [activeTab, showError, workspaceId],
  );

  const runSnapshotCommand = useCallback(
    async (
      command:
        | 'nativeBrowser.newTab'
        | 'nativeBrowser.selectTab'
        | 'nativeBrowser.closeTab',
      args: { workspaceId: string; tabId?: string },
    ): Promise<void> => {
      setError(null);
      try {
        const next =
          command === 'nativeBrowser.newTab'
            ? await api().invoke(command, { workspaceId: args.workspaceId })
            : command === 'nativeBrowser.selectTab'
              ? await api().invoke(command, {
                  workspaceId: args.workspaceId,
                  tabId: requireTabId(args.tabId),
                })
              : await api().invoke(command, {
                  workspaceId: args.workspaceId,
                  tabId: requireTabId(args.tabId),
                });
        applySnapshot(next);
      } catch (reason) {
        showError(reason);
      }
    },
    [applySnapshot, showError],
  );

  const startCapture = useCallback((): void => {
    const tab = activeTab;
    if (!tab || capturePendingRef.current || captureImage) return;
    const generation = generationRef.current;
    capturePendingRef.current = true;
    setError(null);
    void api()
      .invoke('nativeBrowser.beginCapture', { workspaceId, tabId: tab.id })
      .then((capture) => {
        if (generation !== generationRef.current) {
          return api()
            .invoke('nativeBrowser.endCapture', { workspaceId, tabId: tab.id })
            .then(() => undefined);
        }
        captureTabIdRef.current = tab.id;
        setCaptureImage(`data:${capture.mediaType};base64,${capture.base64}`);
        setDrag(null);
      })
      .catch((reason: unknown) => {
        if (generation === generationRef.current) showError(reason);
      })
      .finally(() => {
        capturePendingRef.current = false;
      });
  }, [activeTab, captureImage, showError, workspaceId]);

  const finishCapture = useCallback(
    async (rect?: NativeBrowserRect): Promise<void> => {
      const tabId = captureTabIdRef.current;
      captureTabIdRef.current = null;
      setDrag(null);
      setCaptureImage(null);
      if (!tabId) return;
      try {
        const captured = await api().invoke('nativeBrowser.endCapture', {
          workspaceId,
          tabId,
          ...(rect ? { rect } : {}),
        });
        if (!captured) return;
        const attachment = await api().invoke('session.saveImageAttachment', {
          dataBase64: captured.base64,
          mediaType: captured.mediaType,
          name: 'browser-capture.png',
        });
        emitInsertPath({
          relPath: attachment.name,
          absPath: attachment.path,
          name: attachment.name,
        });
        showNotice('Screenshot added to the chat input.');
      } catch (reason) {
        showError(reason);
      }
    },
    [showError, showNotice, workspaceId],
  );

  useEffect(() => {
    if (!captureImage) return;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      void finishCapture();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [captureImage, finishCapture]);

  const relativePosition = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>): { x: number; y: number } | null => {
      const host = hostRef.current;
      if (!host) return null;
      const rect = host.getBoundingClientRect();
      return { x: event.clientX - rect.left, y: event.clientY - rect.top };
    },
    [],
  );

  const onCapturePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>): void => {
      if (!captureImage) return;
      const point = relativePosition(event);
      if (!point) return;
      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      setDrag({ x0: point.x, y0: point.y, x1: point.x, y1: point.y });
    },
    [captureImage, relativePosition],
  );

  const onCapturePointerMove = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>): void => {
      if (!drag) return;
      const point = relativePosition(event);
      if (!point) return;
      setDrag((current) => (current ? { ...current, x1: point.x, y1: point.y } : current));
    },
    [drag, relativePosition],
  );

  const onCapturePointerUp = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>): void => {
      if (!drag) return;
      const point = relativePosition(event);
      if (!point) {
        void finishCapture();
        return;
      }
      const width = Math.abs(point.x - drag.x0);
      const height = Math.abs(point.y - drag.y0);
      if (width < MIN_CAPTURE_SIZE || height < MIN_CAPTURE_SIZE) {
        void finishCapture();
        return;
      }
      void finishCapture({
        x: Math.min(drag.x0, point.x),
        y: Math.min(drag.y0, point.y),
        width,
        height,
      });
    },
    [drag, finishCapture, relativePosition],
  );

  return {
    snapshot,
    activeTab,
    address,
    error,
    notice,
    captureImage,
    drag,
    hostRef,
    setAddress: setAddressState,
    beginAddressEdit: () => {
      editingAddressRef.current = true;
    },
    endAddressEdit: () => {
      editingAddressRef.current = false;
      if (activeTab) setAddressState(activeTab.url === 'about:blank' ? '' : activeTab.url);
    },
    navigate,
    goBack: () => void invokeTarget('nativeBrowser.back'),
    goForward: () => void invokeTarget('nativeBrowser.forward'),
    reload: () => void invokeTarget('nativeBrowser.reload'),
    setZoom,
    newTab: () => void runSnapshotCommand('nativeBrowser.newTab', { workspaceId }),
    selectTab: (tabId) =>
      void runSnapshotCommand('nativeBrowser.selectTab', { workspaceId, tabId }),
    closeTab: (tabId) =>
      void runSnapshotCommand('nativeBrowser.closeTab', { workspaceId, tabId }),
    startCapture,
    cancelCapture: () => void finishCapture(),
    stopAgentControl: () => {
      void api()
        .invoke('nativeBrowser.stopAgentControl', { workspaceId })
        .catch(showError);
    },
    retry: () => void open(),
    onCapturePointerDown,
    onCapturePointerMove,
    onCapturePointerUp,
  };
}

function normalizeAddress(raw: string): string | null {
  const value = raw.trim();
  if (!value) return null;
  if (/^https?:\/\//i.test(value)) return value;
  if (looksLikeHost(value)) return `https://${value}`;
  const query = new URLSearchParams({ q: value });
  return `https://www.google.com/search?${query.toString()}`;
}

function looksLikeHost(value: string): boolean {
  const authority = value.split('/')[0] ?? '';
  const host = authority.replace(/:\d+$/, '');
  return (
    host === 'localhost' ||
    /^\[[0-9a-f:]+\]$/i.test(host) ||
    /^\d{1,3}(?:\.\d{1,3}){3}$/.test(host) ||
    /^(?:[a-z0-9-]+\.)+[a-z]{2,}$/i.test(host)
  );
}

function clampZoom(value: number): number {
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round(value * 100) / 100));
}

function patchTabZoom(
  snapshot: NativeBrowserSnapshot | null,
  tabId: string,
  zoom: number,
): NativeBrowserSnapshot | null {
  if (!snapshot) return null;
  return {
    ...snapshot,
    tabs: snapshot.tabs.map((tab) => (tab.id === tabId ? { ...tab, zoom } : tab)),
  };
}

function requireTabId(tabId: string | undefined): string {
  if (!tabId) throw new Error('native browser tab id is required');
  return tabId;
}

function errorMessage(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason);
}
