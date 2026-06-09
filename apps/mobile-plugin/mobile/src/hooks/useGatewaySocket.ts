import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { applyGatewayFrame, emptyMobileState, type GatewayFrame, type MobileState } from '../protocol';
import { shouldReconnectAfterClose } from '../socketLifecycle';

export interface GatewaySocketState {
  readonly state: MobileState;
  readonly status: 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'error';
  readonly sendFrame: (frame: Record<string, unknown>) => void;
}

export function useGatewaySocket(gatewayUrl: string, token: string | null): GatewaySocketState {
  const [state, dispatch] = useReducer(applyGatewayFrame, undefined, emptyMobileState);
  const [status, setStatus] = useState<GatewaySocketState['status']>('idle');
  const [retry, setRetry] = useState(0);
  const socketRef = useRef<WebSocket | null>(null);
  const wsUrl = useMemo(() => buildWsUrl(gatewayUrl, token), [gatewayUrl, token]);

  useEffect(() => {
    if (!wsUrl) {
      setStatus('idle');
      dispatch({ type: 'reset' });
      if (retry !== 0) setRetry(0);
      return;
    }
    setStatus(retry === 0 ? 'connecting' : 'reconnecting');
    const socket = new WebSocket(wsUrl);
    socketRef.current = socket;
    let disposed = false;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
    socket.onopen = () => {
      setStatus('connected');
      heartbeatTimer = setInterval(() => {
        if (socket.readyState === WebSocket.OPEN) {
          socket.send(JSON.stringify({ type: 'ping' }));
        }
      }, 15000);
    };
    socket.onmessage = (event) => {
      try {
        dispatch(JSON.parse(String(event.data)) as GatewayFrame);
      } catch {
        dispatch({ type: 'error', message: 'Invalid gateway frame' });
      }
    };
    socket.onerror = () => {
      setStatus('error');
      dispatch({ type: 'error', message: 'Gateway socket error' });
    };
    socket.onclose = () => {
      if (heartbeatTimer) clearInterval(heartbeatTimer);
      const current = socketRef.current === socket;
      if (current) socketRef.current = null;
      if (shouldReconnectAfterClose({ disposed, current })) {
        reconnectTimer = setTimeout(() => setRetry((value) => value + 1), 1200);
      }
    };
    return () => {
      disposed = true;
      if (heartbeatTimer) clearInterval(heartbeatTimer);
      if (reconnectTimer) clearTimeout(reconnectTimer);
      socket.close();
      if (socketRef.current === socket) socketRef.current = null;
    };
  }, [retry, wsUrl]);

  const sendFrame = useCallback((frame: Record<string, unknown>) => {
    const socket = socketRef.current;
    if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(frame));
  }, []);

  return { state, status, sendFrame };
}

function buildWsUrl(gatewayUrl: string, token: string | null): string | null {
  if (!token) return null;
  const url = new URL('/mobile/v1/ws', gatewayUrl);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  url.searchParams.set('token', token);
  return url.toString();
}
