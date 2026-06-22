import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(__dirname, '../../../..');
const tokenSource = readFileSync(
  path.join(repoRoot, 'apps/mobile-plugin/mobile/src/styles/tokens.ts'),
  'utf8',
);

describe('mobile StyleSheet theme', () => {
  it('maps the shared design tokens into React Native-friendly values', () => {
    expect(tokenSource).toContain("import { tokens } from '@moxxy/design-tokens'");
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

    expect(tokenSource).toContain('block: tokens.radius.block');
    expect(tokenSource).toContain('card: tokens.radius.card');
    expect(tokenSource).toContain('pill: tokens.radius.pill');
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
