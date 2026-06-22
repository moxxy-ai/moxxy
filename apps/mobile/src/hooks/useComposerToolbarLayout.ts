import { useMemo } from 'react';
import { useWindowDimensions } from 'react-native';
import { buildComposerToolbarLayout } from '../composerToolbarLayout';

export function useComposerToolbarLayout() {
  const { width } = useWindowDimensions();
  return useMemo(() => buildComposerToolbarLayout({ screenWidth: width }), [width]);
}
