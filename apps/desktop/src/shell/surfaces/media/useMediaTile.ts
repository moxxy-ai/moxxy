import { useEffect, useRef, useState } from 'react';
import { useChatMediaThumbnail } from '@moxxy/client-core';

/** A tile requests its small image only while it is near the visible scroll area. */
export function useMediaTile(workspaceId: string | null, id: string) {
  const ref = useRef<HTMLButtonElement>(null);
  const [shown, setShown] = useState(typeof IntersectionObserver === 'undefined');
  useEffect(() => {
    const element = ref.current;
    if (!element || typeof IntersectionObserver === 'undefined') return undefined;
    const observer = new IntersectionObserver(([entry]) => setShown(entry?.isIntersecting ?? false), {
      rootMargin: '120px',
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const src = useChatMediaThumbnail(workspaceId, id, shown);
  return { ref, src: shown ? src : null };
}
