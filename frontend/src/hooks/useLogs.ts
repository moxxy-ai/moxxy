import { useState, useEffect, useRef } from 'react';

export function useLogs(apiBase: string) {
  const [logs, setLogs] = useState<string[]>([]);
  const logsEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!apiBase) return;
    const evtSource = new EventSource(`${apiBase}/logs`);
    evtSource.onmessage = (e) => {
      if (e.data.trim() === '') return;
      setLogs(prev => [...prev.slice(-199), e.data]);
    };
    return () => evtSource.close();
  }, [apiBase]);

  return { logs, logsEndRef };
}
