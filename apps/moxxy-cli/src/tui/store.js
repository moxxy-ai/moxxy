import { useSyncExternalStore } from 'react';

export function useEventsStore(handler) {
  const snapshot = useSyncExternalStore(
    (callback) => {
      handler.onChange(callback);
      return () => handler.onChange(null);
    },
    () => handler.getSnapshot(),
  );
  return snapshot;
}
