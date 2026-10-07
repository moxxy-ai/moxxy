import { useCallback, useEffect, useRef, useState } from 'react';

/** How long a control goes on saying it copied. */
const SAID_FOR_MS = 1500;

/**
 * Copy text to the clipboard and say so for a moment. `copied` stays false
 * when the clipboard refuses, and the reset timer never outlives the owner
 * (transcript rows unmount on scroll).
 */
export function useCopy(): { readonly copied: boolean; readonly copy: (text: string) => Promise<void> } {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => () => clearTimeout(timer.current), []);

  const copy = useCallback(async (text: string): Promise<void> => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      return;
    }
    setCopied(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), SAID_FOR_MS);
  }, []);

  return { copied, copy };
}
