import { useRef, useState } from 'react';
import { Icon } from '@moxxy/desktop-ui';
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
}

/**
 * The in-window browser pane: a live view of the agent's Playwright page,
 * streamed as frames (`{ type: 'frame', base64, url }`). The user and the agent
 * share ONE page — the agent's navigations/clicks (via `browser_session`) show
 * up here, and the user's clicks/keys/scroll are proxied back to the same page
 * via `surface.input`. Coordinates are sent normalized (0..1) so the backend
 * maps them onto the page viewport regardless of pane size.
 */
export function BrowserPane({ workspaceId }: { readonly workspaceId: string | null }): JSX.Element {
  const [frame, setFrame] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [needsInstall, setNeedsInstall] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [url, setUrl] = useState('');
  const [editingUrl, setEditingUrl] = useState('');
  const imgRef = useRef<HTMLDivElement | null>(null);

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
    }
    if (typeof p?.url === 'string') {
      setUrl(p.url);
      setEditingUrl((cur) => (document.activeElement === urlInputRef.current ? cur : p.url ?? cur));
    }
  };

  const surface = useSurface(workspaceId, 'browser', { onSnapshot: apply, onData: apply });
  const urlInputRef = useRef<HTMLInputElement | null>(null);

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

  // Translate a pointer event in the frame box to normalized page coords.
  const norm = (e: React.MouseEvent): { fx: number; fy: number } | null => {
    const rect = imgRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0 || rect.height === 0) return null;
    return { fx: (e.clientX - rect.left) / rect.width, fy: (e.clientY - rect.top) / rect.height };
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      {/* URL bar */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          navigate(editingUrl);
        }}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          padding: '8px 10px',
          borderBottom: '1px solid var(--color-card-border)',
          flexShrink: 0,
        }}
      >
        <Icon name="globe" size={14} />
        <input
          ref={urlInputRef}
          type="text"
          value={editingUrl}
          placeholder="Enter a URL…"
          onChange={(e) => setEditingUrl(e.target.value)}
          spellCheck={false}
          style={{
            flex: 1,
            minWidth: 0,
            padding: '6px 9px',
            fontSize: 12,
            color: 'var(--color-text)',
            border: '1px solid var(--color-card-border)',
            borderRadius: 8,
            background: 'var(--color-surface)',
            outline: 'none',
          }}
        />
      </form>

      {surface.error && (
        <div style={{ padding: '8px 12px', fontSize: 11.5, color: 'var(--color-danger, #f87171)' }}>
          Browser unavailable: {surface.error}
        </div>
      )}

      {/* Frame surface */}
      <div
        ref={imgRef}
        tabIndex={0}
        onClick={(e) => {
          const n = norm(e);
          if (n) surface.input({ type: 'click', ...n });
        }}
        onWheel={(e) => surface.input({ type: 'scroll', dy: e.deltaY })}
        onKeyDown={(e) => {
          // Forward typing + common control keys to the page.
          if (e.key.length === 1 || ['Enter', 'Backspace', 'Tab', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) {
            surface.input({ type: 'key', key: e.key });
          }
        }}
        style={{
          flex: 1,
          minHeight: 0,
          overflow: 'hidden',
          background: '#0b0f17',
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'center',
          outline: 'none',
          cursor: frame ? 'crosshair' : 'default',
        }}
      >
        {frame ? (
          <img src={frame} alt={url || 'browser'} style={{ width: '100%', height: 'auto', display: 'block' }} />
        ) : (
          <div
            style={{
              padding: 24,
              fontSize: 12,
              color: 'var(--color-text-dim)',
              textAlign: 'center',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 12,
            }}
          >
            <div>{status ?? (surface.ready ? 'Loading…' : 'Starting browser…')}</div>
            {(needsInstall || installing) && (
              <button
                type="button"
                onClick={startInstall}
                disabled={installing}
                style={{
                  padding: '7px 14px',
                  fontSize: 12,
                  fontWeight: 600,
                  color: '#fff',
                  border: 'none',
                  borderRadius: 8,
                  cursor: installing ? 'default' : 'pointer',
                  background: installing ? 'var(--color-text-dim)' : 'var(--color-accent, #6366f1)',
                  opacity: installing ? 0.7 : 1,
                }}
              >
                {installing ? 'Installing…' : 'Install browser engine (~200MB)'}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
