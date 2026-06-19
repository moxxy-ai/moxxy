import { useEffect, useRef, useState } from 'react';
import { api } from '@moxxy/client-core';
import { Button, Icon, IconButton } from '@moxxy/desktop-ui';
import { emitInsertPath } from '../WorkspaceFiles';
import { useReducedMotion } from '../useReducedMotion';
import { useSurface } from './useSurface';

interface BrowserFrame {
  readonly type?: string;
  readonly base64?: string;
  readonly mime?: string;
  readonly url?: string;
  /** Carried by `{ type: 'status' }` payloads — launch progress or a hard error. */
  readonly text?: string;
  /** Set on a status when the Playwright engine isn't installed — the pane shows
   *  an "Install" button (the download is ~200MB, so we ask first). */
  readonly needsInstall?: boolean;
  /** Carried by `{ type: 'captured' }` — a PNG of the dragged region. */
  readonly mediaType?: string;
}

/** A drag rectangle in pane-relative pixels (region-capture mode). */
interface DragRect {
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
}

const ZOOM_MIN = 0.25;
const ZOOM_MAX = 5;
const clampZoom = (z: number): number => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round(z * 100) / 100));

/** Keys (beyond single printable chars) we forward to the page; everything else
 *  — lone modifiers, F-keys, etc. — is ignored so it can't drive the host UI. */
const NAMED_KEYS = new Set([
  'Enter', 'Backspace', 'Tab', 'Escape', 'Delete',
  'Home', 'End', 'PageUp', 'PageDown',
  'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown',
]);

/** Brand spinner (matches ChatLoading) for the launching/installing states.
 *  Under prefers-reduced-motion the continuous spin is replaced by a static
 *  ring so it doesn't drive vestibular motion. */
function Spinner({ size = 22, reduced = false }: { readonly size?: number; readonly reduced?: boolean }): JSX.Element {
  return (
    <span
      aria-hidden
      style={{
        width: size,
        height: size,
        borderRadius: '50%',
        border: '2.5px solid var(--color-card-border)',
        borderTopColor: 'var(--color-primary)',
        animation: reduced ? undefined : 'moxxy-spin 0.8s linear infinite',
      }}
    />
  );
}

/**
 * The in-window browser pane: a live, interactive view of the agent's Playwright
 * page. Frames stream in as JPEGs (`{ type: 'frame', base64, url }`); the user's
 * clicks/hover/keys/scroll/navigation are proxied back to the SAME page via
 * `surface.input`, and the pane resizes the page viewport to fill the container
 * (`surface.resize`). The agent and the user share ONE page.
 */
export function BrowserPane({ workspaceId }: { readonly workspaceId: string | null }): JSX.Element {
  const [frame, setFrame] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [needsInstall, setNeedsInstall] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [url, setUrl] = useState('');
  const [editingUrl, setEditingUrl] = useState('');
  const [zoom, setZoom] = useState(1);
  // Region-capture mode: drag a box, screenshot it, attach to the chat input.
  const [capturing, setCapturing] = useState(false);
  const [drag, setDrag] = useState<DragRect | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const reducedMotion = useReducedMotion();
  const hostRef = useRef<HTMLDivElement | null>(null);
  const urlInputRef = useRef<HTMLInputElement | null>(null);
  const lastMoveRef = useRef(0);
  const zoomRef = useRef(1); // latest zoom, read by keyboard handlers (no stale closure)
  // Coalesced wheel scrolling: accumulate deltas and flush one IPC per frame so
  // a precision trackpad (dozens-to-hundreds of events/sec) can't flood the
  // channel / Playwright dispatch.
  const wheelAccumRef = useRef(0);
  const wheelRafRef = useRef(0);
  const noticeTimerRef = useRef(0);

  const apply = (payload: unknown): void => {
    const p = payload as BrowserFrame;
    if (p?.type === 'frame' && typeof p.base64 === 'string') {
      setFrame(`data:${p.mime ?? 'image/jpeg'};base64,${p.base64}`);
      setStatus(null);
      setNeedsInstall(false);
      setInstalling(false);
    } else if (p?.type === 'status') {
      setStatus(typeof p.text === 'string' ? p.text : null);
      // A `needsInstall` status re-arms the button (e.g. an install that failed);
      // any other status during install is progress, so leave `installing` as-is.
      if (p.needsInstall) {
        setNeedsInstall(true);
        setInstalling(false);
      }
    } else if (p?.type === 'captured' && typeof p.base64 === 'string') {
      void attachCapture(p.base64, p.mediaType);
    }
    if (typeof p?.url === 'string') {
      setUrl(p.url);
      setEditingUrl((cur) => (document.activeElement === urlInputRef.current ? cur : p.url ?? cur));
    }
  };

  const surface = useSurface(workspaceId, 'browser', { onSnapshot: apply, onData: apply });
  // Stable ref so the resize effect always reaches the latest sender.
  const surfaceRef = useRef(surface);
  surfaceRef.current = surface;

  // Keep the page viewport matched to the pane so the live view fills the whole
  // container (no letterbox) and click coords map 1:1. Debounced to one rAF.
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let raf = 0;
    const send = (): void => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        const width = Math.round(host.clientWidth);
        const height = Math.round(host.clientHeight);
        if (width > 0 && height > 0) surfaceRef.current.resize({ width, height });
      });
    };
    send(); // push an initial size (and cover envs without ResizeObserver)
    // ResizeObserver is absent in some test/headless environments — degrade to
    // the one-shot size above rather than throwing on mount.
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(send);
    ro.observe(host);
    return () => {
      if (raf) cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, []);

  // Push the initial size once the surface attaches (the ResizeObserver's first
  // fire may land before the runner is ready, when resize is a no-op).
  useEffect(() => {
    if (!surface.ready) return;
    const host = hostRef.current;
    if (host && host.clientWidth > 0 && host.clientHeight > 0) {
      surface.resize({ width: Math.round(host.clientWidth), height: Math.round(host.clientHeight) });
    }
  }, [surface.ready]); // eslint-disable-line react-hooks/exhaustive-deps

  const navigate = (raw: string): void => {
    const u = raw.trim();
    if (!u) return;
    const withScheme = /^https?:\/\//i.test(u) ? u : `https://${u}`;
    surface.input({ type: 'navigate', url: withScheme });
  };

  const startInstall = (): void => {
    setInstalling(true);
    setNeedsInstall(false);
    setStatus('Installing browser engine… (one-time, ~200MB)');
    surface.input({ type: 'install' });
  };

  const setZoomTo = (next: number): void => {
    const z = clampZoom(next);
    zoomRef.current = z;
    setZoom(z);
    surface.input({ type: 'zoom', factor: z });
  };

  const flashNotice = (text: string): void => {
    setNotice(text);
    // Clear any prior pending timer so a rapid second notice doesn't leave an
    // orphaned timeout, and store the handle so unmount can cancel it (no
    // setState-after-unmount). The unmount cleanup lives in the effect below.
    if (noticeTimerRef.current) window.clearTimeout(noticeTimerRef.current);
    noticeTimerRef.current = window.setTimeout(() => {
      noticeTimerRef.current = 0;
      setNotice((cur) => (cur === text ? null : cur));
    }, 4000);
  };

  // Cancel a pending notice timer (and any queued wheel flush) on unmount.
  useEffect(
    () => () => {
      if (noticeTimerRef.current) window.clearTimeout(noticeTimerRef.current);
      if (wheelRafRef.current) cancelAnimationFrame(wheelRafRef.current);
    },
    [],
  );

  // Accumulate wheel deltas; flush a single { type: 'scroll', dy } per frame.
  const onWheel = (e: React.WheelEvent): void => {
    wheelAccumRef.current += e.deltaY;
    if (wheelRafRef.current) return;
    wheelRafRef.current = requestAnimationFrame(() => {
      wheelRafRef.current = 0;
      const dy = wheelAccumRef.current;
      wheelAccumRef.current = 0;
      if (dy !== 0) surface.input({ type: 'scroll', dy });
    });
  };

  // The captured region (a sharp PNG) is saved to a temp file and dropped into
  // the chat composer as an attachment — the user then describes the change and
  // sends, and the agent SEES the area. Reuses the same insert event the file
  // tree uses, so the chip appears in the (visible) composer.
  const attachCapture = async (base64: string, mediaType?: string): Promise<void> => {
    try {
      const att = await api().invoke('session.saveImageAttachment', {
        dataBase64: base64,
        mediaType: mediaType ?? 'image/png',
        name: 'browser-capture.png',
      });
      emitInsertPath({ relPath: att.name, absPath: att.path, name: att.name });
      flashNotice('📎 Screenshot added to the chat input — describe the change and send.');
    } catch {
      flashNotice('Could not attach the screenshot.');
    }
  };

  // Pointer event → normalized page coords (0..1 of the frame box).
  const norm = (e: React.MouseEvent): { fx: number; fy: number } | null => {
    const rect = hostRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0 || rect.height === 0) return null;
    return { fx: (e.clientX - rect.left) / rect.width, fy: (e.clientY - rect.top) / rect.height };
  };

  // Pointer event → pane-relative px (for the drag-selection overlay).
  const relPos = (e: React.MouseEvent): { x: number; y: number } | null => {
    const rect = hostRef.current?.getBoundingClientRect();
    if (!rect) return null;
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const onHover = (e: React.MouseEvent): void => {
    const now = Date.now();
    if (now - lastMoveRef.current < 90) return; // throttle hover RPCs
    lastMoveRef.current = now;
    const n = norm(e);
    if (n) surface.input({ type: 'move', ...n });
  };

  const onKeyDown = (e: React.KeyboardEvent): void => {
    // Browser zoom (⌘/Ctrl +/−/0) — intercept before key-forwarding so it zooms
    // the PAGE, not the whole desktop app (Electron's default for these chords).
    if ((e.metaKey || e.ctrlKey) && !e.altKey) {
      if (e.key === '=' || e.key === '+') {
        e.preventDefault();
        setZoomTo(zoomRef.current + 0.1);
        return;
      }
      if (e.key === '-' || e.key === '_') {
        e.preventDefault();
        setZoomTo(zoomRef.current - 0.1);
        return;
      }
      if (e.key === '0') {
        e.preventDefault();
        setZoomTo(1);
        return;
      }
    }
    if (e.key === 'Escape') {
      // Escape is the keyboard ESCAPE HATCH. Tab (and arrows/etc.) are forwarded
      // to the page so they drive in-page navigation — which means a keyboard
      // user who tabs INTO this view can't tab back out (WCAG 2.1.2 "no keyboard
      // trap"). Escape blurs the host so focus returns to the surrounding UI;
      // in capture mode it first cancels the in-progress capture.
      e.preventDefault();
      if (capturing) {
        setCapturing(false);
        setDrag(null);
        return;
      }
      hostRef.current?.blur();
      return;
    }
    const printable = e.key.length === 1;
    if (!printable && !NAMED_KEYS.has(e.key)) return; // ignore lone modifiers, F-keys, …
    const hasMod = e.ctrlKey || e.metaKey || e.altKey;
    e.preventDefault(); // keep Tab/arrows/space from scrolling or moving host focus
    if (printable && !hasMod) {
      surface.input({ type: 'key', key: e.key }); // type the character
      return;
    }
    // Build a Playwright press() combo for control keys + shortcuts (e.g. Meta+a).
    const mods: string[] = [];
    if (e.ctrlKey) mods.push('Control');
    if (e.metaKey) mods.push('Meta');
    if (e.altKey) mods.push('Alt');
    if (e.shiftKey) mods.push('Shift');
    let base = e.key === ' ' ? 'Space' : e.key;
    if (base.length === 1) base = base.toLowerCase();
    surface.input({ type: 'key', key: [...mods, base].join('+') });
  };

  const hasView = frame != null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      {/* Toolbar: back / forward / reload + address bar */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 4,
          padding: '6px 8px',
          borderBottom: '1px solid var(--color-card-border)',
          flexShrink: 0,
        }}
      >
        <IconButton size={26} onClick={() => surface.input({ type: 'back' })} title="Back" aria-label="Back">
          <Icon name="chevron-right" size={14} style={{ transform: 'rotate(180deg)' }} />
        </IconButton>
        <IconButton size={26} onClick={() => surface.input({ type: 'forward' })} title="Forward" aria-label="Forward">
          <Icon name="chevron-right" size={14} />
        </IconButton>
        <IconButton size={26} onClick={() => surface.input({ type: 'reload' })} title="Reload" aria-label="Reload">
          <Icon name="rotate" size={14} />
        </IconButton>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            navigate(editingUrl);
            hostRef.current?.focus();
          }}
          style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center' }}
        >
          <input
            ref={urlInputRef}
            type="text"
            value={editingUrl}
            placeholder="Search or enter a URL…"
            onChange={(e) => setEditingUrl(e.target.value)}
            spellCheck={false}
            style={{
              flex: 1,
              minWidth: 0,
              padding: '6px 11px',
              fontSize: 12,
              color: 'var(--color-text)',
              border: '1px solid var(--color-card-border)',
              borderRadius: 999,
              background: 'var(--color-surface)',
              outline: 'none',
            }}
          />
        </form>
        {/* Zoom controls (⌘+/⌘−/⌘0 also work when the view is focused). */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 2,
            border: '1px solid var(--color-card-border)',
            borderRadius: 999,
            padding: '0 2px',
          }}
        >
          <IconButton size={22} onClick={() => setZoomTo(zoom - 0.1)} title="Zoom out (⌘−)" aria-label="Zoom out">
            <span style={{ fontSize: 14, lineHeight: 1 }}>−</span>
          </IconButton>
          <button
            type="button"
            onClick={() => setZoomTo(1)}
            title="Reset zoom (⌘0)"
            className="btn-ghost"
            style={{ fontSize: 11, minWidth: 38, padding: '2px 2px', color: 'var(--color-text-dim)' }}
          >
            {Math.round(zoom * 100)}%
          </button>
          <IconButton size={22} onClick={() => setZoomTo(zoom + 0.1)} title="Zoom in (⌘+)" aria-label="Zoom in">
            <span style={{ fontSize: 14, lineHeight: 1 }}>+</span>
          </IconButton>
        </div>
        {/* "Capture region" — drag a box; the screenshot is attached to the chat
         *  input so you can ask the agent to change exactly that area. */}
        <IconButton
          size={26}
          bordered={capturing}
          onClick={() => {
            setCapturing((v) => !v);
            setDrag(null);
          }}
          title={
            capturing
              ? 'Drag a box to capture it for the agent (Esc to cancel)'
              : 'Capture a region for the agent'
          }
          aria-label="Capture region"
          style={capturing ? { color: 'var(--color-primary)' } : undefined}
        >
          <Icon name="attach" size={14} />
        </IconButton>
      </div>

      {/* Capture mode hint / "added to chat input" confirmation. */}
      {(capturing || notice) && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            padding: '6px 12px',
            fontSize: 12,
            color: notice ? 'var(--color-green)' : 'var(--color-text-muted)',
            borderBottom: '1px solid var(--color-card-border)',
            background: 'var(--color-input-soft)',
            flexShrink: 0,
          }}
        >
          {notice ?? 'Drag a box over the area to capture for the agent — Esc to cancel.'}
        </div>
      )}

      {surface.error && (
        <div style={{ padding: '8px 12px', fontSize: 11.5, color: 'var(--color-danger, #f87171)' }}>
          Browser unavailable: {surface.error}
        </div>
      )}

      {/* Live view / interaction surface — fills the container */}
      <div
        ref={hostRef}
        tabIndex={0}
        // `application` tells assistive tech to pass keystrokes through to this
        // interactive surface (the keys are proxied to the live page) rather
        // than intercepting them for browse-mode navigation. The label names
        // the region and advertises the Escape hatch out of the keyboard trap.
        role="application"
        aria-label="Browser view — interactive. Press Escape to leave."
        onMouseDown={(e) => {
          if (capturing) {
            const p = relPos(e);
            if (p) {
              e.preventDefault();
              setDrag({ x0: p.x, y0: p.y, x1: p.x, y1: p.y });
            }
            return;
          }
          hostRef.current?.focus();
        }}
        onMouseMove={(e) => {
          if (capturing) {
            if (drag) {
              const p = relPos(e);
              if (p) setDrag((d) => (d ? { ...d, x1: p.x, y1: p.y } : d));
            }
            return;
          }
          if (hasView) onHover(e);
        }}
        onMouseUp={() => {
          if (!capturing || !drag) return;
          const rect = hostRef.current?.getBoundingClientRect();
          setDrag(null);
          setCapturing(false);
          if (!rect || rect.width === 0 || rect.height === 0) return;
          const minX = Math.min(drag.x0, drag.x1);
          const minY = Math.min(drag.y0, drag.y1);
          const w = Math.abs(drag.x1 - drag.x0);
          const h = Math.abs(drag.y1 - drag.y0);
          if (w < 6 || h < 6) return; // too small — treat as a stray click
          surface.input({
            type: 'capture',
            fx: minX / rect.width,
            fy: minY / rect.height,
            fw: w / rect.width,
            fh: h / rect.height,
          });
        }}
        onClick={(e) => {
          if (capturing) return; // drag handles capture mode
          const n = norm(e);
          if (n) surface.input({ type: 'click', ...n });
        }}
        onDoubleClick={(e) => {
          if (capturing) return;
          const n = norm(e);
          if (n) surface.input({ type: 'dblclick', ...n });
        }}
        onWheel={onWheel}
        onKeyDown={onKeyDown}
        style={{
          flex: 1,
          minHeight: 0,
          position: 'relative',
          overflow: 'hidden',
          background: '#0b0f17',
          outline: 'none',
          cursor: capturing ? 'crosshair' : 'default',
        }}
      >
        {/* Drag-selection overlay (region capture). */}
        {drag && (
          <div
            style={{
              position: 'absolute',
              left: Math.min(drag.x0, drag.x1),
              top: Math.min(drag.y0, drag.y1),
              width: Math.abs(drag.x1 - drag.x0),
              height: Math.abs(drag.y1 - drag.y0),
              border: '2px solid var(--color-primary)',
              background: 'color-mix(in srgb, var(--color-primary) 14%, transparent)',
              pointerEvents: 'none',
              zIndex: 2,
            }}
          />
        )}
        {hasView ? (
          <img
            src={frame ?? undefined}
            alt={url || 'browser'}
            draggable={false}
            style={{
              width: '100%',
              height: '100%',
              objectFit: 'contain',
              display: 'block',
              userSelect: 'none',
            }}
          />
        ) : (
          <div
            style={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 14,
              padding: 24,
              textAlign: 'center',
            }}
          >
            {needsInstall && !installing ? (
              <>
                <div
                  style={{
                    width: 46,
                    height: 46,
                    borderRadius: 12,
                    display: 'grid',
                    placeItems: 'center',
                    background: 'color-mix(in srgb, var(--color-primary) 14%, transparent)',
                    color: 'var(--color-primary)',
                  }}
                >
                  <Icon name="globe" size={22} />
                </div>
                <div style={{ maxWidth: 280 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-text)' }}>
                    Browser engine required
                  </div>
                  <div style={{ marginTop: 4, fontSize: 12, color: 'var(--color-text-dim)', lineHeight: 1.5 }}>
                    The in-window browser needs Playwright + Chromium — a one-time ~200&nbsp;MB download.
                  </div>
                </div>
                <Button variant="primary" size="sm" onClick={startInstall}>
                  Install browser engine
                </Button>
              </>
            ) : (
              <>
                <Spinner reduced={reducedMotion} />
                <div style={{ fontSize: 13, color: 'var(--color-text)' }}>
                  {installing ? 'Installing browser engine…' : surface.ready ? 'Loading…' : 'Starting browser…'}
                </div>
                {installing && (
                  <div style={{ width: 'min(320px, 80%)', display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {/* Indeterminate progress bar (mirrors the app-update look). */}
                    <div
                      style={{
                        height: 6,
                        borderRadius: 999,
                        background: 'var(--color-card-border)',
                        overflow: 'hidden',
                      }}
                    >
                      <div
                        style={{
                          height: '100%',
                          // Under reduced motion the shimmer becomes a static
                          // filled bar (no continuous travelling animation).
                          width: reducedMotion ? '100%' : '40%',
                          borderRadius: 999,
                          background: 'var(--color-primary)',
                          animation: reducedMotion ? undefined : 'moxxy-shimmer 1.1s linear infinite',
                        }}
                      />
                    </div>
                    {status && (
                      <div
                        style={{
                          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
                          fontSize: 10.5,
                          color: 'var(--color-text-dim)',
                          whiteSpace: 'nowrap',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                        }}
                        title={status}
                      >
                        {status}
                      </div>
                    )}
                  </div>
                )}
                {!installing && status && !surface.error && (
                  <div style={{ fontSize: 12, color: 'var(--color-text-dim)', maxWidth: 320 }}>{status}</div>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
