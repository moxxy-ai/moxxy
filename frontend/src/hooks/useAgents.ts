import { useState, useEffect } from 'react';
import type { Skill, Schedule, Channel, McpServer } from '../types';

export function useAgents(apiBase: string) {
  const [agents, setAgents] = useState<string[]>([]);
  const [activeAgent, setActiveAgent] = useState<string | null>(null);
  const [stm, setStm] = useState<string>('Memory void.');
  const [skills, setSkills] = useState<Skill[]>([]);
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [mcpServers, setMcpServers] = useState<McpServer[]>([]);
  const [vaultKeys, setVaultKeys] = useState<string[]>([]);
  const [sttEnabled, setSttEnabled] = useState(false);

  useEffect(() => {
    if (!apiBase) return;
    fetch(`${apiBase}/agents`)
      .then(res => res.json())
      .then(data => {
        if (data.agents) {
          setAgents(data.agents);
          if (data.agents.length > 0 && !activeAgent) {
            setActiveAgent(data.agents.includes('default') ? 'default' : data.agents[0]);
          }
        }
      })
      .catch(err => console.error("Failed to fetch agents", err));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiBase]);

  useEffect(() => {
    if (!activeAgent || !apiBase) return;

    fetch(`${apiBase}/agents/${activeAgent}/memory/short`)
      .then(res => res.json())
      .then(data => setStm(data.content || 'Memory void.'))
      .catch(() => setStm('Link failed.'));

    fetch(`${apiBase}/agents/${activeAgent}/skills`)
      .then(res => res.json())
      .then(data => { if (data.success) setSkills(data.skills || []); })
      .catch(() => setSkills([]));

    fetch(`${apiBase}/agents/${activeAgent}/channels`)
      .then(res => res.json())
      .then(data => {
        if (data.success) {
          setChannels(data.channels || []);
          const tgData = (data.channels || []).find((c: Channel) => c.type === 'telegram');
          if (tgData) setSttEnabled(!!tgData.stt_enabled);
        }
      })
      .catch(() => setChannels([]));

    fetch(`${apiBase}/agents/${activeAgent}/schedules`)
      .then(res => res.json())
      .then(data => { if (data.success) setSchedules(data.schedules || []); })
      .catch(() => setSchedules([]));

    fetch(`${apiBase}/agents/${activeAgent}/mcp`)
      .then(res => res.json())
      .then(data => { if (data.success) setMcpServers(data.mcp_servers || []); })
      .catch(() => setMcpServers([]));

    fetch(`${apiBase}/agents/${activeAgent}/vault`)
      .then(res => res.json())
      .then(data => { if (data.success) setVaultKeys(data.keys || []); })
      .catch(() => setVaultKeys([]));
  }, [activeAgent, apiBase]);

  return {
    agents, setAgents,
    activeAgent, setActiveAgent,
    stm, setStm,
    skills, setSkills,
    schedules, setSchedules,
    channels, setChannels,
    mcpServers, setMcpServers,
    vaultKeys, setVaultKeys,
    sttEnabled, setSttEnabled,
  };
}
