import { describe, expect, it } from 'vitest';
import { tokens } from '@moxxy/design-tokens';
import tailwindConfig from '../../tailwind.config';

// Guards the tailwind ↔ design-tokens derivation: the NativeWind palette must
// stay the projection of @moxxy/design-tokens, never drift into inline values.
describe('tailwind config', () => {
  const extend = tailwindConfig.theme.extend;

  it('derives its colors from @moxxy/design-tokens', () => {
    expect(extend.colors.appBg).toBe(tokens.color.appBg);
    expect(extend.colors.primary).toBe(tokens.color.primary);
    expect(extend.colors.primaryStrong).toBe(tokens.color.primaryStrong);
    expect(extend.colors.muted).toBe(tokens.color.textMuted);
    expect(extend.colors.dim).toBe(tokens.color.textDim);
    expect(extend.colors.red).toBe(tokens.color.red);
  });

  it('derives radii, shadow, and fonts from the tokens', () => {
    expect(extend.borderRadius.card).toBe(`${tokens.radius.card}px`);
    expect(extend.borderRadius.pill).toBe(`${tokens.radius.pill}px`);
    expect(extend.boxShadow.card).toBe(tokens.shadow.card);
    expect(extend.fontFamily.sans).toEqual([tokens.font.sans]);
  });

  // Ported from the reference's mobile-theme test: pin the actual desktop
  // light-theme values so a tokens-package edit that would silently restyle
  // the mobile app shows up here as an explicit diff.
  it('matches the desktop light theme palette', () => {
    expect(extend.colors).toMatchObject({
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
    expect(extend.borderRadius).toMatchObject({
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
