import { StyleSheet, View, type ViewProps } from 'react-native';
import { Gradient } from './primitives/Gradient';

export function AppShell({ children, style, ...props }: ViewProps) {
  return (
    <View {...props} style={[styles.shell, style]}>
      {/* A whisper-faint brand mesh behind every screen — the glass chrome and
       *  cards read with real depth against it instead of a flat grey. */}
      <Gradient
        pointerEventsNone
        direction="diagonal"
        stops={[
          { offset: 0, color: '#fbf0f6' },
          { offset: 0.5, color: '#f2f3fa' },
          { offset: 1, color: '#eef7fb' },
        ]}
        style={StyleSheet.absoluteFill}
      />
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  shell: {
    backgroundColor: '#f3f5fb',
    flex: 1,
    minHeight: '100%',
  },
});
