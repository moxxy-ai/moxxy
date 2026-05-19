import React, { useEffect, useState } from 'react';
import { Box } from 'ink';
import type { Session } from '@moxxy/core';
import { BootScreen, type BootEvent, type BootEventId } from '../components/BootScreen.js';
import { InputBox } from '../components/InputBox.js';
import { FooterHints } from '../components/FooterHints.js';
import { SessionView } from './SessionView.js';
import type { InteractiveSessionProps } from './props.js';

/**
 * Outer shell: mounts the BootScreen first, runs `bootstrap()` in an
 * effect, and swaps to the real `SessionView` once a `Session` is
 * available. Callers that already have a `Session` can pass `session`
 * directly and skip the boot phase.
 */
export const InteractiveSession: React.FC<InteractiveSessionProps> = ({
  session: eagerSession,
  bootstrap,
  registerInteractiveResolver,
  model,
  version,
  resumed,
}) => {
  const [session, setSession] = useState<Session | null>(eagerSession ?? null);
  const [bootEvents, setBootEvents] = useState<ReadonlyArray<BootEvent>>([]);
  const [bootError, setBootError] = useState<{ failedStep?: BootEventId; message: string } | null>(
    null,
  );
  // First-prompt gate: the boot screen stays visible (input enabled
  // once the session resolves) until the user submits something. Only
  // then do we swap to the chat view — prevents the splash from
  // flashing past on fast boots.
  const [initialPrompt, setInitialPrompt] = useState<string | null>(null);
  const startedAt = React.useMemo(() => Date.now(), []);

  useEffect(() => {
    if (eagerSession || !bootstrap) return;
    let cancelled = false;
    void (async () => {
      try {
        const s = await bootstrap((step) => {
          if (cancelled) return;
          if (step.kind === 'provider-failed') {
            setBootEvents((prev) => [
              ...prev,
              { id: 'provider-activated', at: Date.now(), failed: true },
            ]);
            return;
          }
          if (step.kind === 'ready') return;
          setBootEvents((prev) => [
            ...prev,
            {
              id: step.kind as BootEventId,
              at: Date.now(),
              ...(step.detail ? { detail: step.detail } : {}),
            },
          ]);
        });
        if (cancelled) return;
        setSession(s);
      } catch (err) {
        if (cancelled) return;
        setBootError({
          failedStep: 'provider-activated',
          message: err instanceof Error ? err.message : String(err),
        });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [eagerSession, bootstrap]);

  // Splash phase: render the BootScreen until the user submits the
  // first prompt. The input unlocks the moment a session resolves; the
  // submission flips us into the chat view AND becomes the first turn.
  // Resumed sessions skip the splash entirely — the user wants to land
  // back in their conversation without re-typing anything.
  if (!session || (initialPrompt == null && !resumed)) {
    const ready = session != null && bootError == null;
    return (
      <Box flexDirection="column">
        <BootScreen
          events={bootEvents}
          startedAt={startedAt}
          {...(version ? { version } : {})}
          {...(bootError ? { error: bootError } : {})}
        />
        <Box marginTop={2}>
          <InputBox
            disabled={!ready}
            placeholder={
              ready
                ? 'type a prompt to begin · / for commands'
                : bootError
                  ? 'Bootstrap failed — quit and run `moxxy init`'
                  : 'Initializing…'
            }
            onSubmit={(text) => {
              if (!ready) return;
              const trimmed = text.trim();
              if (trimmed) setInitialPrompt(trimmed);
            }}
          />
        </Box>
        <Box marginTop={1}>
          <FooterHints mode={ready ? 'default' : 'boot'} />
        </Box>
      </Box>
    );
  }

  return (
    <SessionView
      session={session}
      registerInteractiveResolver={registerInteractiveResolver}
      {...(initialPrompt ? { initialPrompt } : {})}
      {...(model ? { model } : {})}
      {...(version ? { version } : {})}
    />
  );
};
