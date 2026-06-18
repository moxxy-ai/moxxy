import { useEffect, useRef, useState } from 'react';
import { api } from '@moxxy/client-core';
import { Button, Icon, IconButton } from '@moxxy/desktop-ui';
import { useSurface } from './useSurface';

/** An element the user pointed at in "select element" mode (from the `pick`
 *  sidecar method) — handed to the agent to act on. */
interface PickedElement {
  readonly selector: string;
  readonly tag: string;
  readonly text: string;
}

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
  /** Carried by `{ type: 'picked' }` — the element under the user's click. */
  readonly element?: PickedElement | null;
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

/** Brand spinner (matches ChatLoading) for the launching/installing states. */
function Spinner({ size = 22 }: { readonly size?: number }): JSX.Element {
  return (
    <span
      aria-hidden
      style={{
        width: size,
        height: size,
        borderRadius: '50%',
        border: '2.5px solid var(--color-card-border)',
        borderTopColor: 'var(--color-primary)',
        animation: 'moxxy-spin 0.8s linear infinite',
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
  // "Select element" mode: the next click picks an element instead of clicking.
  const [picking, setPicking] = useState(false);
  const [picked, setPicked] = useState<PickedElement | null>(null);
  const [change, setChange] = useState('');
  const [sent, setSent] = useState(false);
  const hostRef = useRef<HTMLDivElement | null>(null);
  const urlInputRef = useRef<HTMLInputElement | null>(null);
  const lastMoveRef = useRef(0);
  const zoomRef = useRef(1); // latest zoom, read by keyboard handlers (no stale closure)

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
    } else if (p?.type === 'picked') {
      if (p.element) {
        setPicked(p.element);
        setChange('');
        setSent(false);
      }
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

  // Task the agent to change the picked element (localhost dev loop). The agent's
  // browser_session tool can act on the selector we captured.
  const askAgent = (): void => {
    if (!picked || !workspaceId) return;
    const what = change.trim();
    if (!what) return;
    const where = url ? ` on ${url}` : '';
    const ctx = picked.text ? ` (currently "${picked.text}")` : '';
    const prompt = `Using the browser, change the element \`${picked.selector}\`${ctx}${where} to: ${what}`;
    void api().invoke('session.runTurn', { workspaceId, prompt }).catch(() => undefined);
    setSent(true);
    setPicked(null);
    setChange('');
  };

  // Pointer event → normalized page coords (0..1 of the frame box).
  const norm = (e: React.MouseEvent): { fx: number; fy: number } | null => {
    const rect = hostRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0 || rect.height === 0) return null;
    return { fx: (e.clientX - rect.left) / rect.width, fy: (e.clientY - rect.top) / rect.height };
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
    if (e.key === 'Escape' && picking) {
      e.preventDefault();
      setPicking(false);
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
        {/* "Select element" — pick an element on the page to hand to the agent. */}
        <IconButton
          size={26}
          bordered={picking}
          onClick={() => setPicking((v) => !v)}
          title={picking ? 'Click an element to select it (Esc to cancel)' : 'Select an element for the agent'}
          aria-label="Select element"
          style={picking ? { color: 'var(--color-primary)' } : undefined}
        >
          <Icon name="context" size={14} />
        </IconButton>
      </div>

      {/* Picked element → task the agent to change it (localhost dev loop). */}
      {(picked || sent) && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '8px 10px',
            borderBottom: '1px solid var(--color-card-border)',
            background: 'var(--color-input-soft)',
            flexShrink: 0,
          }}
        >
          {sent && !picked ? (
            <span style={{ fontSize: 12, color: 'var(--color-green)' }}>
              ✓ Asked the agent — see the Chat tab for the response.
            </span>
          ) : (
            <>
              <Icon name="context" size={13} />
              <code
                title={picked?.selector}
                style={{
                  fontSize: 11,
                  color: 'var(--color-text-muted)',
                  maxWidth: 200,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  flexShrink: 0,
                }}
              >
                {picked?.selector}
              </code>
              <input
                value={change}
                onChange={(e) => setChange(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    askAgent();
                  } else if (e.key === 'Escape') {
                    setPicked(null);
                  }
                }}
                autoFocus
                placeholder="Describe the change for the agent… (e.g. make it blue)"
                style={{
                  flex: 1,
                  minWidth: 0,
                  padding: '5px 10px',
                  fontSize: 12,
                  color: 'var(--color-text)',
                  border: '1px solid var(--color-card-border)',
                  borderRadius: 8,
                  background: 'var(--color-surface)',
                  outline: 'none',
                }}
              />
              <Button variant="primary" size="sm" onClick={askAgent} disabled={change.trim().length === 0}>
                Ask agent
              </Button>
              <IconButton size={22} onClick={() => setPicked(null)} title="Dismiss" aria-label="Dismiss">
                <Icon name="x" size={13} />
              </IconButton>
            </>
          )}
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
        onMouseDown={() => hostRef.current?.focus()}
        onClick={(e) => {
          const n = norm(e);
          if (!n) return;
          if (picking) {
            // Capture the element instead of clicking it through to the page.
            surface.input({ type: 'pick', ...n });
            setPicking(false);
          } else {
            surface.input({ type: 'click', ...n });
          }
        }}
        onDoubleClick={(e) => {
          const n = norm(e);
          if (n) surface.input({ type: 'dblclick', ...n });
        }}
        onMouseMove={hasView ? onHover : undefined}
        onWheel={(e) => surface.input({ type: 'scroll', dy: e.deltaY })}
        onKeyDown={onKeyDown}
        style={{
          flex: 1,
          minHeight: 0,
          position: 'relative',
          overflow: 'hidden',
          background: '#0b0f17',
          outline: 'none',
          cursor: picking ? 'crosshair' : 'default',
        }}
      >
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
                <Spinner />
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
                          width: '40%',
                          borderRadius: 999,
                          background: 'var(--color-primary)',
                          animation: 'moxxy-shimmer 1.1s linear infinite',
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
