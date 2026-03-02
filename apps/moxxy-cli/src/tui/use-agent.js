import { useState, useEffect, useCallback, useRef } from 'react';

export function useAgent(client, initialAgentId) {
  const [agent, setAgent] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const pollRef = useRef(null);

  const fetchAgent = useCallback(async (id) => {
    if (!id) return;
    try {
      setLoading(true);
      const data = await client.getAgent(id);
      setAgent(data);
      setError(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [client]);

  const startRun = useCallback(async (task) => {
    if (!agent) return null;
    try {
      const result = await client.startRun(agent.id, task);
      setAgent(prev => prev ? { ...prev, status: 'running' } : prev);
      return result;
    } catch (err) {
      setError(err.message);
      return null;
    }
  }, [client, agent]);

  const stopAgent = useCallback(async () => {
    if (!agent) return;
    try {
      await client.stopAgent(agent.id);
      setAgent(prev => prev ? { ...prev, status: 'idle' } : prev);
    } catch (err) {
      setError(err.message);
    }
  }, [client, agent]);

  useEffect(() => {
    if (initialAgentId) {
      fetchAgent(initialAgentId);
    } else {
      setLoading(false);
    }
  }, [initialAgentId, fetchAgent]);

  useEffect(() => {
    if (!agent || agent.status !== 'running') return;
    pollRef.current = setInterval(() => fetchAgent(agent.id), 5000);
    return () => clearInterval(pollRef.current);
  }, [agent?.id, agent?.status, fetchAgent]);

  return { agent, loading, error, startRun, stopAgent };
}
