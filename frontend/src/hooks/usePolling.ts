import { useState, useEffect, useRef } from 'react';
import type { ChatMessage, StreamMessage } from '../types';

export function usePolling(apiBase: string, activeAgent: string | null) {
  const [chatHistory, setChatHistory] = useState<ChatMessage[]>([]);
  const [streamMessages, setStreamMessages] = useState<StreamMessage[]>([]);
  const [optimisticUserMsg, setOptimisticUserMsg] = useState<string | null>(null);
  const [chatInput, setChatInput] = useState('');
  const [isTyping, setIsTyping] = useState(false);

  const chatEndRef = useRef<HTMLDivElement>(null);
  const sessionCursorRef = useRef<number>(0);
  const seenIdsRef = useRef<Set<number>>(new Set());
  const isStreamingRef = useRef(false);

  useEffect(() => {
    if (!activeAgent || !apiBase) return;

    let stopped = false;
    sessionCursorRef.current = 0;
    seenIdsRef.current = new Set();

    const toChatItems = (messages: { id?: number; role?: string; content?: string }[]) => messages
      .filter((m) => m && (m.role === 'user' || m.role === 'assistant'))
      .map((m) => ({
        id: Number(m.id) || 0,
        sender: m.role === 'user' ? 'user' as const : 'agent' as const,
        text: String(m.content ?? ''),
      }));

    const applySnapshot = async () => {
      try {
        const res = await fetch(`${apiBase}/agents/${activeAgent}/session/messages?after=0&limit=300`);
        const data = await res.json();
        if (stopped || !data?.success) return;

        const messages = Array.isArray(data.messages) ? data.messages : [];
        const chatItems = toChatItems(messages);
        const maxId = messages.reduce((max: number, m: { id?: number }) => Math.max(max, Number(m?.id) || 0), 0);
        sessionCursorRef.current = maxId;

        seenIdsRef.current = new Set(chatItems.map(c => c.id).filter(id => id > 0));

        if (chatItems.length > 0) {
          setChatHistory(chatItems);
        } else {
          setChatHistory([]);
        }
      } catch {
        if (!stopped) {
          setChatHistory([]);
        }
      }
    };

    const pollUpdates = async () => {
      if (isStreamingRef.current) return;
      try {
        const res = await fetch(`${apiBase}/agents/${activeAgent}/session/messages?after=${sessionCursorRef.current}&limit=200`);
        const data = await res.json();
        if (stopped || !data?.success) return;

        const messages = Array.isArray(data.messages) ? data.messages : [];
        if (messages.length === 0) return;

        const maxId = messages.reduce((max: number, m: { id?: number }) => Math.max(max, Number(m?.id) || 0), sessionCursorRef.current);
        sessionCursorRef.current = maxId;

        const chatItems = toChatItems(messages);
        const newItems = chatItems.filter(c => c.id > 0 && !seenIdsRef.current.has(c.id));
        if (newItems.length === 0) return;

        for (const item of newItems) {
          seenIdsRef.current.add(item.id);
        }

        setOptimisticUserMsg(prevMsg => {
          if (prevMsg && newItems.some(c => c.sender === 'user' && c.text === prevMsg)) {
            return null;
          }
          return prevMsg;
        });
        setChatHistory(prev => [...prev, ...newItems]);
      } catch {
        // Ignore transient polling errors.
      }
    };

    void applySnapshot();
    const timer = setInterval(() => { void pollUpdates(); }, 1200);

    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [activeAgent, apiBase]);

  const forcePollUpdates = async () => {
    try {
      const res = await fetch(`${apiBase}/agents/${activeAgent}/session/messages?after=${sessionCursorRef.current}&limit=200`);
      const data = await res.json();
      if (!data?.success) return;

      const messages = Array.isArray(data.messages) ? data.messages : [];
      if (messages.length === 0) return;

      const maxId = messages.reduce((max: number, m: { id?: number }) => Math.max(max, Number(m?.id) || 0), sessionCursorRef.current);
      sessionCursorRef.current = maxId;

      const chatItems = messages
        .filter((m: { role?: string }) => m && (m.role === 'user' || m.role === 'assistant'))
        .map((m: { id?: number; role?: string; content?: string }) => ({
          id: Number(m.id) || 0,
          sender: m.role === 'user' ? 'user' as const : 'agent' as const,
          text: String(m.content ?? ''),
        }));

      const newItems = chatItems.filter((c: ChatMessage) => c.id > 0 && !seenIdsRef.current.has(c.id));
      if (newItems.length === 0) return;

      for (const item of newItems) {
        seenIdsRef.current.add(item.id);
      }

      setOptimisticUserMsg(prevMsg => {
        if (prevMsg && newItems.some((c: ChatMessage) => c.sender === 'user' && c.text === prevMsg)) {
          return null;
        }
        return prevMsg;
      });
      setChatHistory(prev => [...prev, ...newItems]);
    } catch {
      // ignore
    }
  };

  const handleChatSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!chatInput.trim() || !activeAgent) return;

    const prompt = chatInput;
    setChatInput('');
    setOptimisticUserMsg(prompt);
    setStreamMessages([]);
    setIsTyping(true);
    isStreamingRef.current = true;

    try {
      const res = await fetch(`${apiBase}/agents/${activeAgent}/chat/stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt })
      });

      const reader = res.body?.getReader();
      if (!reader) throw new Error('No readable stream');

      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.startsWith('data:')) continue;
          const jsonStr = line.slice(5).trim();
          if (!jsonStr) continue;

          try {
            const evt = JSON.parse(jsonStr);
            switch (evt.type) {
              case 'thinking':
                setStreamMessages(prev => [...prev, { sender: 'agent', text: `[thinking] ${evt.text}` }]);
                break;
              case 'skill_invoke':
                setStreamMessages(prev => [...prev, { sender: 'agent', text: `> Invoking skill: ${evt.skill}` }]);
                break;
              case 'skill_result':
                if (!evt.success) {
                  setStreamMessages(prev => [...prev, { sender: 'agent', text: `> Skill error: ${evt.output}` }]);
                }
                break;
              case 'response':
                break;
              case 'error':
                setStreamMessages(prev => [...prev, { sender: 'agent', text: `System Failure: ${evt.message}` }]);
                break;
              case 'done':
                setStreamMessages([]);
                isStreamingRef.current = false;
                void forcePollUpdates();
                break;
            }
          } catch { /* ignore malformed SSE lines */ }
        }
      }
      setIsTyping(false);
    } catch (err) {
      isStreamingRef.current = false;
      setIsTyping(false);
      setStreamMessages(prev => [...prev, { sender: 'agent', text: `Uplink Error: ${err}` }]);
      void forcePollUpdates();
    }
  };

  return {
    chatHistory, setChatHistory,
    streamMessages, setStreamMessages,
    optimisticUserMsg, setOptimisticUserMsg,
    chatInput, setChatInput,
    isTyping,
    chatEndRef,
    sessionCursorRef,
    seenIdsRef,
    handleChatSubmit,
  };
}
