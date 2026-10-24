import { useCallback, useState } from 'react';
import { toErrorMessage } from '@moxxy/client-core';
import { openLocalFile } from './local-file-link';

/** Opens a linked local file and keeps why the last attempt failed, until the next one. */
export function useLocalFileLink(filePath: string): { readonly open: () => void; readonly failure: string | null } {
  const [failure, setFailure] = useState<string | null>(null);
  const open = useCallback(() => {
    setFailure(null);
    openLocalFile(filePath).catch((e: unknown) => setFailure(toErrorMessage(e)));
  }, [filePath]);
  return { open, failure };
}
