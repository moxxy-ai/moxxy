import { useEffect, useRef, useState } from 'react';
import { api } from '@moxxy/client-core';
import type { ConnectionPhase } from '@moxxy/desktop-ipc-contract';
import { pushToast } from '../notices/toast-store';

const RETIRED_SIGN_IN = 'openai-codex';
const EXPLANATION = 'ChatGPT sign-in was removed. Moxxy now uses official OpenAI connections. Install or connect Codex, add an OpenAI API key, or choose another model connection.';

/** Show the migration where the person works; the runner owns activation. */
export function useProviderMigrationNotice(phase: ConnectionPhase | undefined): string | null {
  const [retired, setRetired] = useState(false);
  const said = useRef(false);
  const provider = phase?.phase === 'connected' ? phase.activeProvider : null;
  useEffect(() => {
    let cancelled = false;
    void api().invoke('onboarding.status').then(status => {
      if (!cancelled) setRetired(status.activeProvider === RETIRED_SIGN_IN);
    }).catch(() => undefined);
    return () => { cancelled = true; };
  }, []);
  useEffect(() => {
    if (!retired || !provider || said.current) return;
    said.current = true;
    pushToast({
      id: 'retired-chatgpt-sign-in', tone: 'info', title: 'ChatGPT sign-in was removed',
      body: provider === 'codex-agent'
        ? 'This chat now uses ChatGPT — Codex agent through your installed Codex and its own sign-in.'
        : `This chat now uses ${provider}. You can change the model connection in Settings.`,
    });
  }, [provider, retired]);
  return retired && !provider ? EXPLANATION : null;
}
