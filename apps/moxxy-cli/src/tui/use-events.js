import { useState, useEffect, useRef, useCallback } from 'react';
import { createSseClient } from '../sse-client.js';

const CHAT_EVENT_TYPES = new Set([
  'message.delta', 'message.final',
  'run.started', 'run.completed', 'run.failed',
  'skill.invoked', 'skill.completed', 'skill.failed',
  'primitive.invoked', 'primitive.completed', 'primitive.failed',
  'security.violation', 'sandbox.denied',
]);

export function useEvents(client, agentId) {
  const [messages, setMessages] = useState([]);
  const [stats, setStats] = useState({
    eventCount: 0,
    tokenEstimate: 0,
    skills: {},
    primitives: {},
  });
  const [connected, setConnected] = useState(false);
  const sseRef = useRef(null);
  const assistantBufferRef = useRef('');

  const processEvent = useCallback((event) => {
    const type = event.event_type;
    const payload = event.payload || {};

    setStats(prev => {
      const next = { ...prev, eventCount: prev.eventCount + 1 };
      if (type === 'skill.invoked' && payload.name) {
        next.skills = { ...prev.skills };
        next.skills[payload.name] = (next.skills[payload.name] || 0) + 1;
      }
      if (type === 'primitive.invoked' && payload.name) {
        next.primitives = { ...prev.primitives };
        next.primitives[payload.name] = (next.primitives[payload.name] || 0) + 1;
      }
      if (type === 'model.response' && payload.usage) {
        next.tokenEstimate = prev.tokenEstimate + (payload.usage.total_tokens || 0);
      }
      return next;
    });

    if (type === 'message.delta') {
      assistantBufferRef.current += (payload.content || payload.text || '');
      setMessages(prev => {
        const last = prev[prev.length - 1];
        if (last && last.type === 'assistant' && last.streaming) {
          return [...prev.slice(0, -1), { ...last, content: assistantBufferRef.current }];
        }
        return [...prev, { type: 'assistant', content: assistantBufferRef.current, streaming: true, ts: event.ts }];
      });
      return;
    }

    if (type === 'message.final') {
      const finalContent = payload.content || payload.text || assistantBufferRef.current;
      assistantBufferRef.current = '';
      setMessages(prev => {
        const last = prev[prev.length - 1];
        if (last && last.type === 'assistant' && last.streaming) {
          return [...prev.slice(0, -1), { ...last, content: finalContent, streaming: false }];
        }
        return [...prev, { type: 'assistant', content: finalContent, streaming: false, ts: event.ts }];
      });
      return;
    }

    if (CHAT_EVENT_TYPES.has(type)) {
      setMessages(prev => [...prev, { type: 'event', eventType: type, payload, ts: event.ts }]);
    }
  }, []);

  useEffect(() => {
    if (!agentId) return;
    let active = true;

    const connectWithRetry = async () => {
      let retryCount = 0;
      while (active && retryCount < 10) {
        try {
          const sse = createSseClient(client.baseUrl, client.token, { agent_id: agentId });
          sseRef.current = sse;
          setConnected(true);
          retryCount = 0;
          for await (const event of sse.stream()) {
            if (!active) return;
            processEvent(event);
          }
          if (!active) return;
        } catch (err) {
          if (err.name === 'AbortError' || !active) return;
          retryCount++;
          setConnected(false);
          const delay = Math.min(1000 * Math.pow(2, retryCount), 30000);
          await new Promise(r => setTimeout(r, delay));
        }
      }
    };

    connectWithRetry();

    return () => {
      active = false;
      if (sseRef.current) sseRef.current.disconnect();
    };
  }, [agentId, client.baseUrl, client.token, processEvent]);

  const addUserMessage = useCallback((content) => {
    assistantBufferRef.current = '';
    setMessages(prev => [...prev, { type: 'user', content, ts: Date.now() }]);
  }, []);

  return { messages, stats, connected, addUserMessage };
}
