import { useEffect, useState } from 'react';
import type { ClientSession as Session } from '@moxxy/sdk';
import { activeAgentCliNotice, type AgentCliNotice } from '@moxxy/chat-model';

/** What to say about the active agent's CLI; re-read whenever the session says its info changed. */
export function useAgentCliNotice(session: Session): AgentCliNotice | null {
  const [, setVersion] = useState(0);
  useEffect(() => session.onInfoChanged?.(() => setVersion((n) => n + 1)), [session]);
  const info = session.getInfo();
  return activeAgentCliNotice(info.providers, info.activeProvider);
}
