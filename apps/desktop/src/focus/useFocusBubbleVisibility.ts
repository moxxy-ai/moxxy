import { useCallback, useState } from 'react';

/** Keeps an explicit hide choice scoped to the exact task/reply being shown. */
export function useFocusBubbleVisibility(contentKey: string | null): {
  readonly hidden: boolean;
  readonly hide: () => void;
  readonly show: () => void;
} {
  const [hiddenKey, setHiddenKey] = useState<string | null>(null);
  const hide = useCallback(() => {
    if (contentKey) setHiddenKey(contentKey);
  }, [contentKey]);
  const show = useCallback(() => setHiddenKey(null), []);
  return { hidden: contentKey !== null && hiddenKey === contentKey, hide, show };
}
