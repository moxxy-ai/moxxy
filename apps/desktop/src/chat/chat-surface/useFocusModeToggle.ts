import { useCallback } from 'react';
import { api } from '@moxxy/client-core';

export function useFocusModeToggle(): () => void {
  return useCallback(() => {
    void api().invoke('focus.toggle').catch(() => undefined);
  }, []);
}
