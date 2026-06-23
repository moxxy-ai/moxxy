import { StatusBar } from 'expo-status-bar';
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  type PropsWithChildren,
} from 'react';
import { useColorScheme } from 'react-native';
import { useStorageState } from '../hooks/storage';
import {
  darkPalette,
  lightPalette,
  palettes,
  setActivePalette,
  type Palette,
  type ThemeScheme,
} from '../styles/tokens';

const STORAGE_KEY = 'moxxy.theme.mode';

/** The user's stored preference. `system` follows the OS appearance; `light`
 *  and `dark` pin a single palette. Dark is the product default. */
export type ThemeMode = 'system' | 'light' | 'dark';

export const THEME_MODES: ReadonlyArray<ThemeMode> = ['system', 'light', 'dark'];

export function isThemeMode(value: string | null): value is ThemeMode {
  return value === 'system' || value === 'light' || value === 'dark';
}

export function resolveScheme(mode: ThemeMode, system: ThemeScheme | null): ThemeScheme {
  if (mode === 'system') return system ?? 'dark';
  return mode;
}

interface ThemeContextValue {
  readonly mode: ThemeMode;
  readonly scheme: ThemeScheme;
  readonly colors: Palette;
  readonly setMode: (mode: ThemeMode) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: PropsWithChildren) {
  const system = useColorScheme();
  const [[, storedMode], setStoredMode] = useStorageState(STORAGE_KEY);
  const mode: ThemeMode = isThemeMode(storedMode) ? storedMode : 'dark';
  const scheme = resolveScheme(mode, system === 'light' ? 'light' : system === 'dark' ? 'dark' : null);

  // Point the render-time `sx()` color resolver at the active palette before
  // any descendant renders. AppShell / ScreenFrame consume this context, so a
  // scheme change re-renders the screen roots and their `sx()` calls re-read it.
  setActivePalette(scheme);

  const setMode = useCallback(
    (next: ThemeMode) => setStoredMode(next),
    [setStoredMode],
  );

  const value = useMemo<ThemeContextValue>(
    () => ({ mode, scheme, colors: palettes[scheme], setMode }),
    [mode, scheme, setMode],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const value = useContext(ThemeContext);
  if (value) return value;
  // Fallback for trees rendered without a provider (e.g. isolated tests): keep
  // the dark default so colors still resolve.
  return {
    mode: 'dark',
    scheme: 'dark',
    colors: darkPalette,
    setMode: () => undefined,
  };
}

/** Convenience: the active palette only. */
export function useThemeColors(): Palette {
  return useTheme().colors;
}

/** Status-bar content tuned to the active scheme (light glyphs on dark). */
export function ThemedStatusBar() {
  const { scheme } = useTheme();
  return <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />;
}

export { lightPalette, darkPalette };
