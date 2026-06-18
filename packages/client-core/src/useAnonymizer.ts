import { useCallback, useState } from 'react';
import { api } from './transport.js';
import { toErrorMessage } from './errors.js';
import type { AnonymizerParseResult } from '@moxxy/desktop-ipc-contract';

export interface UseAnonymizer {
  /** Open the document picker and parse the chosen file to text in main.
   *  Returns null if the picker was cancelled. The parse result is a
   *  discriminated union (`{text}` | `{error}`) — a bad parse is data, not a
   *  thrown error. All redaction then happens in the renderer (offline). */
  readonly pickAndParse: () => Promise<AnonymizerParseResult | null>;
  /** Parse a drag-and-dropped document from the base64 BYTES the renderer
   *  already holds (the dropped file's contents) — no path crosses the boundary,
   *  so main reads no arbitrary file. The caller reads the `File` + base64-encodes
   *  it (this hook is DOM-free, so it takes plain strings). Same offline guarantee
   *  + result shape as {@link pickAndParse}. */
  readonly parseDroppedBytes: (name: string, dataBase64: string) => Promise<AnonymizerParseResult>;
  /** Save renderer-produced redacted text via a native Save dialog. Returns the
   *  chosen path, or null if cancelled. */
  readonly save: (suggestedName: string, content: string) => Promise<string | null>;
  readonly busy: boolean;
  readonly error: string | null;
}

/** Thin wrapper over the host-only `anonymizer.*` IPC (native pickers + file
 *  I/O). The actual PII detection + redaction is done in the renderer with
 *  `@moxxy/anonymizer`, so documents never cross a network boundary. */
export function useAnonymizer(): UseAnonymizer {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pickAndParse = useCallback(async (): Promise<AnonymizerParseResult | null> => {
    setBusy(true);
    setError(null);
    try {
      const path = await api().invoke('anonymizer.pickDocument');
      if (!path) return null;
      return await api().invoke('anonymizer.parseDocument', { path });
    } catch (e) {
      const message = toErrorMessage(e);
      setError(message);
      return { error: message };
    } finally {
      setBusy(false);
    }
  }, []);

  const parseDroppedBytes = useCallback(
    async (name: string, dataBase64: string): Promise<AnonymizerParseResult> => {
      setBusy(true);
      setError(null);
      try {
        return await api().invoke('anonymizer.parseDocumentBytes', { name, dataBase64 });
      } catch (e) {
        const message = toErrorMessage(e);
        setError(message);
        return { error: message };
      } finally {
        setBusy(false);
      }
    },
    [],
  );

  const save = useCallback(
    async (suggestedName: string, content: string): Promise<string | null> => {
      setError(null);
      try {
        return await api().invoke('anonymizer.saveRedacted', { suggestedName, content });
      } catch (e) {
        setError(toErrorMessage(e));
        return null;
      }
    },
    [],
  );

  return { pickAndParse, parseDroppedBytes, save, busy, error };
}
