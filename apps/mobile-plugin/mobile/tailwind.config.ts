import type { Config } from 'tailwindcss';
import nativeWindPreset from 'nativewind/preset';

export default {
  content: [
    './app/**/*.{ts,tsx}',
    './src/**/*.{ts,tsx}',
  ],
  darkMode: 'class',
  presets: [nativeWindPreset],
  theme: {
    extend: {
      colors: {
        appBg: '#f1f2f9',
        cardBg: '#ffffff',
        cardBorder: '#e3e5f0',
        cardBorderStrong: '#cdd1e3',
        text: '#0f172a',
        muted: '#475569',
        dim: '#94a3b8',
        primary: '#ec4899',
        primaryStrong: '#db2777',
        primarySoft: '#fdf2f8',
        accent: '#22d3ee',
        accentStrong: '#06b6d4',
        purple: '#8b5cf6',
        green: '#10b981',
        amber: '#f59e0b',
        red: '#ef4444',
      },
      borderRadius: {
        block: '8px',
        card: '14px',
        pill: '9999px',
      },
      boxShadow: {
        card: '0 1px 2px rgba(15, 23, 42, 0.04), 0 10px 24px -18px rgba(15, 23, 42, 0.10)',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'sans-serif'],
        mono: ['JetBrains Mono', 'ui-monospace', 'SF Mono', 'Menlo', 'monospace'],
      },
    },
  },
} satisfies Config;
