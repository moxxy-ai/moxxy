import { useCallback, useEffect, useRef, useState } from 'react';
import * as Clipboard from 'expo-clipboard';

const COPIED_RESET_MS = 1400;

export function useMessageCopy() {
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null);
  const resetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const copyMessage = useCallback(async (messageId: string, text: string) => {
    if (text.trim().length === 0) return;
    await Clipboard.setStringAsync(text);
    setCopiedMessageId(messageId);

    if (resetTimerRef.current) clearTimeout(resetTimerRef.current);
    resetTimerRef.current = setTimeout(() => {
      setCopiedMessageId((current) => (current === messageId ? null : current));
    }, COPIED_RESET_MS);
  }, []);

  useEffect(() => {
    return () => {
      if (resetTimerRef.current) clearTimeout(resetTimerRef.current);
    };
  }, []);

  return {
    copiedMessageId,
    copyMessage,
  };
}
