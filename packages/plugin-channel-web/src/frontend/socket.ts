import { useCallback, useEffect, useRef, useState } from 'react';
import type { ViewDoc } from '@moxxy/sdk';
import type { ClientFrame, ServerFrame } from '../protocol';
import { applyView, canGoBack, currentEntry, goBack, initialNav, navigateTo, type NavState } from './view-store';

export interface TranscriptMessage {
  readonly role: 'assistant' | 'user';
  readonly text: string;
}

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
    const token = new URLSearchParams(window.location.search).get('t') ?? '';
    const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${proto}://${window.location.host}/ws?t=${encodeURIComponent(token)}`);
    wsRef.current = ws;
    ws.onopen = () => setConnected(true);
    ws.onclose = () => setConnected(false);
    ws.onmessage = (ev: MessageEvent) => {
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
      } else if (frame.kind === 'status') {
        if (frame.phase === 'done') setStatus(null);
        else if (frame.phase === 'error') setStatus({ text: frame.text || 'error', error: true });
        else setStatus({ text: frame.text || 'working…', error: false });
      }
    };
    return () => ws.close();
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
