import { useEffect, useRef, useState } from 'react';
import { api } from '@moxxy/client-core';
import type { ConnectionPhase } from '@moxxy/desktop-ipc-contract';
import { pushToast } from '../notices/toast-store';

const RETIRED_SIGN_IN = 'openai-codex';
const EXPLANATION = 'ChatGPT sign-in was removed. Moxxy now uses official OpenAI connections. Install or connect Codex, add an OpenAI API key, or choose another model connection.';

/**
 * Show the migration where the person works; the runner owns activation.
 * Returns the explanation for provider recovery. `toast` only where toasts are
 * on screen (the main shell): the notice is cleared once it has been said, so
 * saying it on a setup screen would lose it.
 */
export function useProviderMigrationNotice(
  phase: ConnectionPhase | undefined,
  { toast }: { readonly toast: boolean },
): string | null {
  const [retired, setRetired] = useState(false);
  const said = useRef(false);
  const provider = phase?.phase === 'connected' ? phase.activeProvider : null;
  useEffect(() => {
    let cancelled = false;
    // Either the runner has not moved the config yet (it still names the
    // retired sign-in) or it already did and left a notice to show once.
    void api().invoke('onboarding.status').then(status => {
      if (!cancelled) setRetired(status.activeProvider === RETIRED_SIGN_IN || status.providerMigration !== null);
    }).catch(() => undefined);
    return () => { cancelled = true; };
  }, []);
  useEffect(() => {
    if (!toast || !retired || !provider || said.current) return;
    said.current = true;
    pushToast({
      id: 'retired-chatgpt-sign-in', tone: 'info', title: 'ChatGPT sign-in was removed',
      body: provider === 'codex-agent'
        ? 'This chat now uses ChatGPT — Codex agent through your installed Codex and its own sign-in.'
        : `This chat now uses ${provider}. You can change the model connection in Settings.`,
    });
    // The runner saved the move by the time it connected: said once, forget it.
    void api().invoke('onboarding.dismissProviderMigration').catch(() => undefined);
  }, [provider, retired, toast]);
  return retired && !provider ? EXPLANATION : null;
}
