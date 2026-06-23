import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(__dirname, '../../..');
const tokenSource = readFileSync(
  path.join(repoRoot, 'apps/mobile/src/styles/tokens.ts'),
  'utf8',
);
const providerSource = readFileSync(
  path.join(repoRoot, 'apps/mobile/src/theme/ThemeProvider.tsx'),
  'utf8',
);

describe('mobile StyleSheet theme', () => {
  it('maps the shared light + dark design tokens into React Native palettes', () => {
    expect(tokenSource).toContain("import { tokens, darkTokens } from '@moxxy/design-tokens'");
    expect(tokenSource).toContain('const color = tokens.color');

    for (const colorName of [
      'appBg',
      'cardBg',
      'cardBorder',
      'cardBorderStrong',
      'text',
      'textMuted',
      'textDim',
      'primary',
      'primaryStrong',
      'primarySoft',
      'accent',
      'green',
      'amber',
      'red',
    ]) {
      expect(tokenSource).toContain(`${colorName}: color.${colorName}`);
    }

    // Both palettes are built from the shared token objects.
    expect(tokenSource).toContain('export const lightPalette: Palette = buildPalette(tokens.color');
    expect(tokenSource).toContain('export const darkPalette: Palette = buildPalette(darkTokens.color');
    expect(tokenSource).toContain("export const palettes = { light: lightPalette, dark: darkPalette }");

    expect(tokenSource).toContain('block: tokens.radius.block');
    expect(tokenSource).toContain('card: tokens.radius.card');
    expect(tokenSource).toContain('pill: tokens.radius.pill');
  });

  it('resolves sx() colors against a swappable active palette', () => {
    expect(tokenSource).toContain('let activePalette: Palette = darkPalette');
    expect(tokenSource).toContain('export function setActivePalette(scheme: ThemeScheme)');
    expect(tokenSource).toContain('activePalette[name as ColorName]');
  });

  it('keeps reusable semantic styles as StyleSheet specs', () => {
    expect(tokenSource).toContain('export const mobileStyleSpecs');
    expect(tokenSource).toContain('card: {');
    expect(tokenSource).toContain('backgroundColor: mobileTheme.color.cardBg');
    expect(tokenSource).toContain('borderColor: mobileTheme.color.cardBorder');
    expect(tokenSource).toContain('borderRadius: mobileTheme.radius.card');
    expect(tokenSource).toContain('borderWidth: 1');
    expect(tokenSource).toContain('pill: {');
    expect(tokenSource).toContain("alignItems: 'center'");
    expect(tokenSource).toContain('borderRadius: mobileTheme.radius.pill');
    expect(tokenSource).toContain("justifyContent: 'center'");
    expect(tokenSource).toContain('export const mobileStyles = StyleSheet.create');
  });
});

describe('mobile theme provider', () => {
  it('defaults to dark and supports light + system following the OS appearance', () => {
    expect(providerSource).toContain("import { useColorScheme } from 'react-native'");
    expect(providerSource).toContain("export type ThemeMode = 'system' | 'light' | 'dark'");
    expect(providerSource).toContain('setActivePalette(scheme)');
    // Dark is the product default when no preference (or 'system' with no OS hint).
    expect(providerSource).toContain("? storedMode : 'dark'");
    expect(providerSource).toContain("if (mode === 'system') return system ?? 'dark'");
  });
});
