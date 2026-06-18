/**
 * Interactive OAuth sign-in for a provider, driven entirely from the UI.
 *
 * Spawns `moxxy login <provider>` in the host via `provider.login.start` and
 * relays the flow: streamed progress goes to a log box; when the provider asks
 * for a pasted value (the out-of-band token / `code#state` claude-code needs)
 * a `provider.login.prompt` event surfaces an input we answer with
 * `provider.login.answer`. Loopback providers (openai-codex) never prompt —
 * the browser opens, the callback lands, and `provider.login.done` arrives.
 *
 * Shared by Settings → Providers and the onboarding wizard so both get the
 * identical real login (not a "run it in a terminal" hint).
 */

import { useEffect, useRef, useState } from 'react';
import { api, toErrorMessage } from '@moxxy/client-core';
import { Button, TextInput } from '@moxxy/desktop-ui';

type Phase = 'idle' | 'running' | 'done' | 'error';

export function OAuthSignIn({
  provider,
  onSignedIn,
  startLabel,
}: {
  readonly provider: string;
  /** Called once the login exits 0 — the caller activates the provider. */
  readonly onSignedIn?: () => void;
  /** Override the initial button text (defaults to `Sign in with <provider>`). */
  readonly startLabel?: string;
}): JSX.Element {
  const [phase, setPhase] = useState<Phase>('idle');
  const [log, setLog] = useState<string[]>([]);
  const [prompt, setPrompt] = useState<{ question: string; mask: boolean } | null>(null);
  const [answer, setAnswer] = useState('');
  const [error, setError] = useState<string | null>(null);
  const loginIdRef = useRef<string | null>(null);

  // Keep the latest onSignedIn so the []-dep subscription below (which captures
  // its closure at mount) always calls the current callback — callers pass a
  // fresh inline arrow every render, so reading it from a ref avoids firing a
  // stale version when the login completes.
  const onSignedInRef = useRef(onSignedIn);
  onSignedInRef.current = onSignedIn;

  const append = (text: string): void =>
    setLog((cur) => {
      // Split on newlines so the log renders line-by-line; drop empties.
      const lines = text.split(/\r?\n/).filter((l) => l.length > 0);
      return [...cur, ...lines].slice(-200);
    });

  // One set of subscriptions for the component's lifetime, filtered by the
  // active loginId so a stale run's late events can't bleed into a new one.
  useEffect(() => {
    const offs = [
      api().subscribe('provider.login.output', (p) => {
        if (p.loginId === loginIdRef.current) append(p.text);
      }),
      api().subscribe('provider.login.prompt', (p) => {
        if (p.loginId !== loginIdRef.current) return;
        setPrompt({ question: p.question, mask: p.mask });
        setAnswer('');
      }),
      api().subscribe('provider.login.done', (p) => {
        if (p.loginId !== loginIdRef.current) return;
        loginIdRef.current = null;
        setPrompt(null);
        if (p.code === 0) {
          setPhase('done');
          onSignedInRef.current?.();
        } else {
          setPhase('error');
          setError(`Sign-in did not complete (exit ${p.code}).`);
        }
      }),
    ];
    return () => offs.forEach((off) => off());
    // Subscriptions live for the component's lifetime; onSignedIn is read from
    // a ref (above) so we never re-subscribe and never fire a stale closure.
  }, []);

  // Abort a still-running login if the component unmounts (modal closed).
  useEffect(
    () => () => {
      const id = loginIdRef.current;
      if (id) void api().invoke('provider.login.cancel', { loginId: id });
    },
    [],
  );

  const start = async (): Promise<void> => {
    const id = crypto.randomUUID();
    loginIdRef.current = id;
    setPhase('running');
    setError(null);
    setLog([]);
    setPrompt(null);
    try {
      await api().invoke('provider.login.start', { loginId: id, provider });
    } catch (e) {
      loginIdRef.current = null;
      setError(toErrorMessage(e));
      setPhase('error');
    }
  };

  const submit = async (value: string): Promise<void> => {
    const id = loginIdRef.current;
    if (!id) return;
    setPrompt(null); // back to "waiting" until the next prompt / completion
    try {
      await api().invoke('provider.login.answer', { loginId: id, value });
    } catch (e) {
      setError(toErrorMessage(e));
    }
  };

  // claude-code's first prompt offers "paste a token OR press Enter for the
  // browser"; surface both, browser primary. The flag keys off the question
  // text the CLI sends, so it stays true to the actual flow.
  const offersBrowser = prompt !== null && /browser/i.test(prompt.question);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {phase === 'idle' && (
        <Button variant="primary" onClick={() => void start()}>
          {startLabel ?? `Sign in with ${provider}`}
        </Button>
      )}

      {phase === 'done' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <p style={{ margin: 0, fontSize: 13, color: 'var(--color-green, #16a34a)' }}>
            Signed in to {provider}.
          </p>
          <Button onClick={() => void start()}>Re-link {provider}</Button>
        </div>
      )}

      {(phase === 'running' || phase === 'error') && prompt && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <label style={{ fontSize: 12.5, color: 'var(--color-text-muted)', lineHeight: 1.5 }}>
            {prompt.question}
          </label>
          {offersBrowser && (
            <Button variant="primary" onClick={() => void submit('')}>
              Sign in with your browser
            </Button>
          )}
          <div style={{ display: 'flex', gap: 8 }}>
            <TextInput
              type={prompt.mask ? 'password' : 'text'}
              value={answer}
              onChange={(e) => setAnswer(e.target.value)}
              placeholder={offersBrowser ? '…or paste a token' : 'Paste here'}
              autoComplete="off"
              spellCheck={false}
              style={{ flex: 1 }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && answer.trim()) void submit(answer.trim());
              }}
            />
            <Button
              variant={offersBrowser ? 'secondary' : 'primary'}
              disabled={!answer.trim()}
              onClick={() => void submit(answer.trim())}
            >
              {offersBrowser ? 'Use token' : 'Continue'}
            </Button>
          </div>
        </div>
      )}

      {phase === 'running' && !prompt && (
        <p style={{ margin: 0, fontSize: 13, color: 'var(--color-text-muted)' }}>
          Opening your browser — complete the sign-in there…
        </p>
      )}

      {error && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <p role="alert" style={{ margin: 0, fontSize: 12.5, color: 'var(--color-red)' }}>
            {error}
          </p>
          {phase === 'error' && (
            <Button onClick={() => void start()}>Try again</Button>
          )}
        </div>
      )}

      {log.length > 0 && (phase === 'running' || phase === 'error') && (
        <pre
          className="mono"
          style={{
            margin: 0,
            padding: 10,
            background: '#0f172a',
            color: '#e2e8f0',
            borderRadius: 10,
            fontSize: 11,
            maxHeight: 140,
            overflow: 'auto',
            whiteSpace: 'pre-wrap',
          }}
        >
          {log.slice(-30).join('\n')}
        </pre>
      )}
    </div>
  );
}
