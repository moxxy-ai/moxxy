import { useCallback, useState } from 'react';

/** Keeps an explicit hide choice stable until the Focus window is closed. */
export function useFocusBubbleVisibility(): {
  readonly hidden: boolean;
  readonly hide: () => void;
  readonly show: () => void;
} {
  const [hidden, setHidden] = useState(false);
  const hide = useCallback(() => setHidden(true), []);
  const show = useCallback(() => setHidden(false), []);
  return { hidden, hide, show };
}
