import { View, type ViewProps } from 'react-native';

export function AppShell({ children, className = '', ...props }: ViewProps & { readonly className?: string }) {
  return (
    <View {...props} className={`h-screen min-h-screen flex-1 bg-appBg ${className}`}>
      {children}
    </View>
  );
}
