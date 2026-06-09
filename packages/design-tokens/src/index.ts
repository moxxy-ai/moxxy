/**
 * The moxxy design tokens — one framework-neutral source of truth for colors,
 * typography, radii, gradients, and shadows. The desktop renderer projects these
 * to CSS custom properties (see `./css-vars`); a React Native app consumes the
 * same object directly in `StyleSheet.create`. Values mirror the desktop's
 * `styles.css` `:root` block.
 *
 * Radii are plain numbers (CSS appends `px`; RN wants the bare number).
 * Gradients are CSS gradient strings (web-only; RN would map these to a gradient
 * component) and are intentionally kept here so the brand definitions live in
 * one place.
 */

export const tokens = {
  color: {
    appBg: '#f1f2f9',
    cardBg: '#ffffff',
    cardBorder: '#e3e5f0',
    cardBorderStrong: '#cdd1e3',
    text: '#0f172a',
    textMuted: '#475569',
    textDim: '#94a3b8',
    sidebarBg: '#ffffff',
    sidebarBgHover: '#f4f5fb',
    sidebarBgActive: '#fdf2f8',
    sidebarText: '#0f172a',
    sidebarTextDim: '#6b7194',
    sidebarBorder: '#e3e5f0',
    primary: '#ec4899',
    primaryStrong: '#db2777',
    primarySoft: '#fdf2f8',
    send: '#ec4899',
    accent: '#22d3ee',
    accentStrong: '#06b6d4',
    purple: '#8b5cf6',
    green: '#10b981',
    amber: '#f59e0b',
    pink: '#ec4899',
    red: '#ef4444',
  },
  shadow: {
    card: '0 1px 2px rgba(15, 23, 42, 0.04), 0 10px 24px -18px rgba(15, 23, 42, 0.10)',
  },
  gradient: {
    user: 'linear-gradient(135deg, #ec4899 0%, #f472b6 100%)',
    cta: 'linear-gradient(135deg, #ec4899 0%, #db2777 100%)',
    accent: 'linear-gradient(135deg, #38bdf8 0%, #22d3ee 100%)',
  },
  font: {
    sans: "'Inter', system-ui, -apple-system, sans-serif",
    mono: "'JetBrains Mono', ui-monospace, 'SF Mono', Menlo, monospace",
  },
  radius: {
    block: 8,
    card: 14,
    pill: 9999,
  },
} as const;

export type Tokens = typeof tokens;
