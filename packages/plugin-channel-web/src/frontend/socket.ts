import { useCallback, useEffect, useRef, useState } from 'react';
import type { FileDiffDisplay, ViewDoc } from '@moxxy/sdk';
import type { ClientFrame, ServerFrame } from '../protocol';
import { applyView, canGoBack, currentEntry, goBack, initialNav, navigateTo, type NavState } from './view-store';

/** Reconnect backoff bounds for the surface WebSocket. */
const MIN_RECONNECT_MS = 500;
const MAX_RECONNECT_MS = 8_000;

/**
 * The auth token, captured from `?t` at module load — BEFORE the address bar is
 * cleaned (see stripTokenFromUrl) — so reconnects and the WS handshake keep
 * working after the visible URL no longer carries it.
 */
const CAPTURED_TOKEN: string =
  typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('t') ?? '' : '';

function readAuthToken(): string {
  return CAPTURED_TOKEN;
}

/**
 * Drop the `?t=…` token from the visible URL (history-replace, no navigation)
 * once it has been captured, so the bearer token isn't persisted to browser
 * history / shoulder-surfed from the address bar. The WS still authenticates
 * from {@link CAPTURED_TOKEN}. Safe no-op when there is no token or no History.
 */
export function stripTokenFromUrl(): void {
  if (typeof window === 'undefined' || !window.history?.replaceState) return;
  const url = new URL(window.location.href);
  if (!url.searchParams.has('t')) return;
  url.searchParams.delete('t');
  window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
}

/** A prose turn from the user or assistant, mirrored into the transcript. */
export interface TranscriptText {
  readonly role: 'assistant' | 'user';
  readonly text: string;
}

/** A structured file diff (from a Write/Edit tool result) shown inline in the stream. */
export interface TranscriptDiff {
  readonly role: 'diff';
  readonly display: FileDiffDisplay;
}

/** One entry in the chat stream — prose or a rendered diff. */
export type TranscriptMessage = TranscriptText | TranscriptDiff;

export interface ViewSocket {
  readonly connected: boolean;
  readonly view: { viewId: string; doc: ViewDoc } | null;
  readonly canGoBack: boolean;
  readonly messages: TranscriptMessage[];
  readonly status: { text: string; error: boolean } | null;
  /** Submit a form / click an action button → agent turn. */
  dispatch(action: { name: string }, formValues: Record<string, string>): void;
  /** Navigate to a named view — instant if cached, else ask the agent to build it. */
  navigate(name: string): void;
  goBack(): void;
  sendPrompt(text: string): void;
}

/** Opens the surface WebSocket and reduces inbound frames into navigable view state. */
export function useViewSocket(): ViewSocket {
  const [connected, setConnected] = useState(false);
  const [nav, setNav] = useState<NavState>(initialNav);
  const [messages, setMessages] = useState<TranscriptMessage[]>([]);
  const [status, setStatus] = useState<{ text: string; error: boolean } | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const navRef = useRef<NavState>(initialNav);
  const setNavState = useCallback((next: NavState) => {
    navRef.current = next;
    setNav(next);
  }, []);

  const sendAction = useCallback((action: { name: string }, formValues: Record<string, string>) => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    const frame: ClientFrame = {
      kind: 'action',
      actionId: Math.random().toString(36).slice(2),
      viewId: currentEntry(navRef.current)?.viewId ?? null,
      action,
      formValues,
    };
    ws.send(JSON.stringify(frame));
    setStatus({ text: 'working…', error: false });
  }, []);

  useEffect(() => {
    // The token is captured ONCE here, before main.tsx may strip `?t` from the
    // visible address bar (history.replaceState) to keep it out of browser
    // history. Reconnects reuse this captured copy.
    const token = readAuthToken();
    const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
    const wsUrl = `${proto}://${window.location.host}/ws?t=${encodeURIComponent(token)}`;

    let disposed = false;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let backoffMs = MIN_RECONNECT_MS;

    const handleMessage = (ev: MessageEvent): void => {
      let frame: ServerFrame;
      try {
        frame = JSON.parse(String(ev.data)) as ServerFrame;
      } catch {
        return;
      }
      if (frame.kind === 'view') {
        setNavState(applyView(navRef.current, frame));
        setStatus(null);
      } else if (frame.kind === 'message') {
        setMessages((prev) => [...prev, { role: frame.role, text: frame.text }]);
      } else if (frame.kind === 'file-diff') {
        setMessages((prev) => [...prev, { role: 'diff', display: frame.display }]);
      } else if (frame.kind === 'status') {
        if (frame.phase === 'done') setStatus(null);
        else if (frame.phase === 'error') setStatus({ text: frame.text || 'error', error: true });
        else setStatus({ text: frame.text || 'working…', error: false });
      } else if (frame.kind === 'ack') {
        // A rejected action (e.g. the agent is mid-turn) would otherwise leave
        // the optimistic "working…" spinner up forever — clear it with a notice.
        // An accepted action keeps the working status until its turn completes.
        if (!frame.accepted) {
          setStatus({
            text: frame.reason === 'busy' ? 'agent is busy — try again in a moment' : 'action rejected',
            error: true,
          });
        }
      }
    };

    const connect = (): void => {
      if (disposed) return;
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;
      ws.onopen = () => {
        backoffMs = MIN_RECONNECT_MS;
        setConnected(true);
      };
      ws.onmessage = handleMessage;
      ws.onclose = () => {
        wsRef.current = null;
        setConnected(false);
        if (disposed) return;
        // Tunnels (cloudflared/ngrok) and mobile networks drop routinely; the
        // server also closes all sockets on retunnel/stop. Reconnect with capped
        // exponential backoff instead of going permanently dead.
        reconnectTimer = setTimeout(connect, backoffMs);
        backoffMs = Math.min(backoffMs * 2, MAX_RECONNECT_MS);
      };
      // An 'error' that doesn't also fire 'close' would otherwise strand us; the
      // browser always follows a failed/closed socket with 'close', so the
      // reconnect is driven from there. The explicit handler just suppresses the
      // unhandled-error console noise.
      ws.onerror = () => undefined;
    };

    connect();
    return () => {
      disposed = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      const ws = wsRef.current;
      wsRef.current = null;
      if (ws) {
        ws.onclose = null;
        ws.close();
      }
    };
  }, [setNavState]);

  const navigate = useCallback(
    (name: string) => {
      const next = navigateTo(navRef.current, name);
      if (next) {
        setNavState(next); // cached → instant, no agent turn
      } else {
        sendAction({ name: `navigate:${name}` }, {}); // uncached → ask the agent to build it
      }
    },
    [sendAction, setNavState],
  );

  const back = useCallback(() => setNavState(goBack(navRef.current)), [setNavState]);

  const sendPrompt = useCallback((text: string) => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    const frame: ClientFrame = { kind: 'prompt', text };
    ws.send(JSON.stringify(frame));
    setMessages((prev) => [...prev, { role: 'user', text }]);
    setStatus({ text: 'working…', error: false });
  }, []);

  const entry = currentEntry(nav);
  return {
    connected,
    view: entry ? { viewId: entry.viewId, doc: entry.doc } : null,
    canGoBack: canGoBack(nav),
    messages,
    status,
    dispatch: sendAction,
    navigate,
    goBack: back,
    sendPrompt,
  };
}
