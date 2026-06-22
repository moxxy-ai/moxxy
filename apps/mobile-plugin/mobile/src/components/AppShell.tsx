import { StyleSheet, View, type ViewProps } from 'react-native';

export function AppShell({ children, style, ...props }: ViewProps) {
  return (
    <View {...props} style={[styles.shell, style]}>
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
