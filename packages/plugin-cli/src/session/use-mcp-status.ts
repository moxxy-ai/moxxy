import React, { useEffect, useState } from 'react';
import type { ClientSession as Session } from '@moxxy/sdk';

export interface McpStatus {
  connected: number;
  enabled: number;
}

/**
 * MCP attach summary — refreshed on mount, after every /mcp action, and (only
 * once any MCP server is configured) every 5s while the session is open so
 * lazy stubs that connect mid-turn surface in the status bar without needing a
 * user-driven refresh. A session with no MCP servers (or no mcpAdmin) never
 * arms the recurring poll — it would be pure wasted work every 5s.
 */
export function useMcpStatus(session: Session): {
  mcpStatus: McpStatus;
  refreshMcpStatus: () => Promise<void>;
} {
  const [mcpStatus, setMcpStatus] = useState<McpStatus>({ connected: 0, enabled: 0 });
  // Probe once; returns the number of servers seen so the effect can decide
  // whether the recurring poll is worth keeping. The public refreshMcpStatus
  // (Promise<void>) wraps this so callers are unchanged.
  const probeMcpStatus = React.useCallback(async (): Promise<number> => {
    const api = session.mcpAdmin;
    if (!api?.listServers) return 0;
    try {
      const list = await api.listServers();
      const enabled = list.filter((s) => s.enabled);
      setMcpStatus({
        enabled: enabled.length,
        connected: enabled.filter((s) => s.connected).length,
      });
      return list.length;
    } catch {
      // best-effort — leave the previous count visible
      return 0;
    }
  }, [session]);
  const refreshMcpStatus = React.useCallback(async (): Promise<void> => {
    await probeMcpStatus();
  }, [probeMcpStatus]);
  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | null = null;
    let cancelled = false;
    void (async () => {
      const count = await probeMcpStatus();
      // Only arm the recurring poll when MCP is actually in play; an MCP-less
      // session has nothing to re-probe. /mcp actions call refreshMcpStatus
      // directly, so newly-added servers still update on demand.
      if (!cancelled && count > 0) {
        timer = setInterval(() => void probeMcpStatus(), 5000);
      }
    })();
    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
    };
  }, [probeMcpStatus]);
  return { mcpStatus, refreshMcpStatus };
}
