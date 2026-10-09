import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { terminalTheme } from './terminal-theme';

/**
 * The terminal paints to a canvas, so it cannot read the stylesheet itself:
 * its colours are handed to it. They have to be the work panel's own, in
 * whichever theme is on, or the terminal sits in the panel as a block of
 * another colour.
 */

const tokens = (values: Record<string, string>) => (name: string): string => values[name] ?? '';

describe('terminalTheme', () => {
  it('paints the terminal on the work panel’s own background', () => {
    const theme = terminalTheme(
      tokens({ '--color-card-bg': '#212121', '--color-text': '#f5f5f5', '--color-primary': '#ff4a1e' }),
    );
    expect(theme.background).toBe('#212121');
    expect(theme.foreground).toBe('#f5f5f5');
    expect(theme.cursor).toBe('#ff4a1e');
  });

  it('takes the colours a program prints in from the palette, so they read in both themes', () => {
    const theme = terminalTheme(
      tokens({
        '--color-red-text': '#b02730',
        '--color-green': '#0e7a5a',
        '--color-amber-text': '#8a5707',
        '--color-reference': '#0e7490',
        '--color-text-dim': '#7a7a7a',
      }),
    );
    expect(theme.red).toBe('#b02730');
    expect(theme.brightRed).toBe('#b02730');
    expect(theme.green).toBe('#0e7a5a');
    expect(theme.yellow).toBe('#8a5707');
    expect(theme.blue).toBe('#0e7490');
    expect(theme.brightBlack).toBe('#7a7a7a');
  });

  it('still has every colour when the stylesheet has not loaded', () => {
    const theme = terminalTheme(() => '');
    for (const value of Object.values(theme)) expect(value).toMatch(/^#[0-9a-f]{6}$/i);
  });
});

describe('TerminalPane', () => {
  it('paints nothing of its own: no colour is written into the component', () => {
    const source = readFileSync(join(__dirname, 'TerminalPane.tsx'), 'utf8').replace(/\r\n/g, '\n');
    expect(source).not.toMatch(/#[0-9a-fA-F]{6}\b/);
    expect(source).not.toMatch(/style=\{\{/);
  });
});
