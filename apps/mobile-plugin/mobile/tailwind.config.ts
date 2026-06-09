import type { Config } from 'tailwindcss';
import nativeWindPreset from 'nativewind/preset';
import { desktopLightThemeExtension, nativeWindContentGlobs } from './src/themeTokens';

export default {
  content: [...nativeWindContentGlobs],
  darkMode: 'class',
  presets: [nativeWindPreset],
  theme: {
    extend: desktopLightThemeExtension,
  },
} satisfies Config;
