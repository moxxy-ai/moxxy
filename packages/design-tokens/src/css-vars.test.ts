import { describe, it, expect } from 'vitest';
import { tokens } from './index.js';
import { CSS_VAR_MAP, generateRootCss } from './css-vars.js';

describe('generateRootCss', () => {
  it('emits a :root block', () => {
    const css = generateRootCss();
    expect(css.startsWith(':root {\n')).toBe(true);
    expect(css.trimEnd().endsWith('}')).toBe(true);
  });

  it('declares every mapped variable with its token value', () => {
    const css = generateRootCss();
    for (const [name, value] of CSS_VAR_MAP) {
      expect(css).toContain(`  ${name}: ${value};`);
    }
  });

  it('keeps the brand tokens parity with styles.css values', () => {
    const css = generateRootCss();
    // Spot-check the load-bearing brand declarations against the desktop CSS.
    expect(css).toContain('--color-primary: #ec4899;');
    expect(css).toContain('--color-app-bg: #f1f2f9;');
    expect(css).toContain(
      '--color-card-shadow: 0 1px 2px rgba(15, 23, 42, 0.04), 0 10px 24px -18px rgba(15, 23, 42, 0.10);',
    );
    expect(css).toContain('--grad-cta: linear-gradient(135deg, #ec4899 0%, #db2777 100%);');
    expect(css).toContain('--radius-card: 14px;');
  });

  it('renders radii as numbers with a px unit (RN keeps the bare number)', () => {
    expect(tokens.radius.card).toBe(14);
    expect(generateRootCss()).toContain('--radius-card: 14px;');
  });
});
