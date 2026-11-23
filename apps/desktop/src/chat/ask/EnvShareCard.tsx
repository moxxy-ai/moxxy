import { useRef, useState } from 'react';
import type { UseQuestion } from '@moxxy/client-core';

export function EnvShareCard({ request, variant = 'dock' }: {
  request: UseQuestion;
  variant?: 'dock' | 'toast' | 'panel';
}): JSX.Element | null {
  const field = useRef<HTMLInputElement>(null);
  const locked = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const item = request.question?.questions[0];
  if (!item?.vaultName) return null;
  async function finish(value: string | null) {
    if (locked.current || value === '') return;
    locked.current = true;
    setBusy(true);
    setError(false);
    try {
      await request.shareEnv(value);
      if (field.current) field.current.value = '';
    } catch {
      setError(true);
    } finally {
      locked.current = false;
      setBusy(false);
    }
  }
  return (
    <form aria-label="Env Share" className={variant === 'dock' ? 'ask-dock' : 'ask-dock ask-dock--' + variant}
      onSubmit={(event) => { event.preventDefault(); if (field.current) void finish(field.current.value); }}>
      <div className="ask-dock__head"><strong>Env Share</strong></div>
      <label className="question">{item.question}
        <input ref={field} className="ask-dock__field" type="password" autoComplete="off" spellCheck={false} required maxLength={65536} disabled={busy} />
      </label>
      <p className="question__hint">Save or replace {item.vaultName} in your Moxxy vault. The agent receives a reference.</p>
      {error && <p role="alert">Could not finish Env Share. Check the vault and try again.</p>}
      <div className="ask-dock__acts">
        <button className="ask-btn" type="button" disabled={busy} onClick={() => void finish(null)}>Skip</button>
        <button className="ask-btn" data-tone="primary" type="submit" disabled={busy}>Save to vault</button>
      </div>
    </form>
  );
}
