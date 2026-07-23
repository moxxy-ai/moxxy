import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  type RefObject,
} from 'react';

const BOTTOM_TOLERANCE_PX = 48;

function isNearBottom(element: HTMLElement): boolean {
  return element.scrollHeight - element.scrollTop - element.clientHeight <= BOTTOM_TOLERANCE_PX;
}

function selectionBelongsTo(element: HTMLElement): boolean {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || !selection.anchorNode) return false;
  return element.contains(selection.anchorNode);
}

export function useFocusTranscriptAutoScroll(contentKey: string): {
  readonly bodyRef: RefObject<HTMLDivElement>;
  readonly onScroll: () => void;
} {
  const bodyRef = useRef<HTMLDivElement>(null);
  const followLatestRef = useRef(true);

  const updateFollowState = useCallback(() => {
    const element = bodyRef.current;
    if (!element) return;
    followLatestRef.current = !selectionBelongsTo(element) && isNearBottom(element);
  }, []);

  useEffect(() => {
    document.addEventListener('selectionchange', updateFollowState);
    return () => document.removeEventListener('selectionchange', updateFollowState);
  }, [updateFollowState]);

  useLayoutEffect(() => {
    const element = bodyRef.current;
    if (!element || !followLatestRef.current) return;
    element.scrollTop = element.scrollHeight;
  }, [contentKey]);

  return { bodyRef, onScroll: updateFollowState };
}
