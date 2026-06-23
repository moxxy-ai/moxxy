import { StyleSheet, View, type ViewProps } from 'react-native';
import { mobileSurface } from '../styles/tokens';

export function AppShell({ children, style, ...props }: ViewProps) {
  return (
    <View {...props} style={[styles.shell, style]}>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  shell: {
    backgroundColor: mobileSurface.appBg,
    flex: 1,
    minHeight: '100%',
  },
});
