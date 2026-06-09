import { describe, expect, it } from 'vitest';
import tailwindConfig from '../mobile/tailwind.config';

describe('mobile Tailwind theme', () => {
  it('maps the desktop design tokens into NativeWind', () => {
    const theme = tailwindConfig.theme?.extend;

    expect(theme?.colors).toMatchObject({
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
      green: '#10b981',
      amber: '#f59e0b',
      red: '#ef4444',
    });
    expect(theme?.borderRadius).toMatchObject({
      block: '8px',
      card: '14px',
      pill: '9999px',
    });
  });

  it('scans Expo Router screens and reusable mobile components', () => {
    expect(tailwindConfig.content).toEqual([
      './app/**/*.{ts,tsx}',
      './src/**/*.{ts,tsx}',
    ]);
  });
});
