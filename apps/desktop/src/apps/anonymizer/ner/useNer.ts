import { useCallback, useEffect, useRef, useState } from 'react';
import type { PiiSpan } from '@moxxy/anonymizer';
import { aggregate, type NerToken } from './aggregate';

export type NerStatus = 'idle' | 'loading' | 'ready' | 'error';

export interface UseNer {
  readonly status: NerStatus;
  readonly error: string | null;
  /** Run on-device NER over `text` and return `person`/`org`/`location` spans.
   *  Resolves to `[]` (never throws) if the model/runtime fails — the caller's
   *  structured redaction keeps working. */
  readonly detectNames: (text: string) => Promise<readonly PiiSpan[]>;
}

type WorkerReply = { type: string; id?: number; tokens?: NerToken[]; error?: string };

/**
 * Lazily spins up the NER worker (which loads the installed on-device model on
 * first use) and exposes a promise-based `detectNames`. The model is large, so
 * the first call shows `loading`; after that the worker is warm.
 */
export function useNer(): UseNer {
  const workerRef = useRef<Worker | null>(null);
  const pending = useRef(
    new Map<number, { resolve: (t: NerToken[]) => void; reject: (e: Error) => void }>(),
  );
  const reqId = useRef(0);
  const [status, setStatus] = useState<NerStatus>('idle');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const worker = new Worker(new URL('./ner.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (e: MessageEvent): void => {
      const msg = e.data as WorkerReply;
      if (msg.type === 'progress') {
        setStatus((s) => (s === 'ready' ? s : 'loading'));
        return;
      }
      if (msg.id == null) return;
      const entry = pending.current.get(msg.id);
      if (!entry) return;
      pending.current.delete(msg.id);
      if (msg.type === 'result') entry.resolve(msg.tokens ?? []);
      else if (msg.type === 'error') entry.reject(new Error(msg.error ?? 'NER failed'));
    };
    worker.onerror = (e: ErrorEvent): void => {
      setStatus('error');
      setError(e.message || 'The name-detection model failed to load.');
    };
    workerRef.current = worker;
    return () => {
      worker.terminate();
      workerRef.current = null;
      pending.current.clear();
    };
  }, []);

  const detectNames = useCallback(async (text: string): Promise<readonly PiiSpan[]> => {
    const worker = workerRef.current;
    if (!worker || !text.trim()) return [];
    setStatus((s) => (s === 'ready' ? s : 'loading'));
    const id = ++reqId.current;
    try {
      const tokens = await new Promise<NerToken[]>((resolve, reject) => {
        pending.current.set(id, { resolve, reject });
        worker.postMessage({ type: 'infer', id, text });
      });
      setStatus('ready');
      setError(null);
      return aggregate(tokens, text);
    } catch (e) {
      setStatus('error');
      setError(e instanceof Error ? e.message : String(e));
      return [];
    }
  }, []);

  return { status, error, detectNames };
}
