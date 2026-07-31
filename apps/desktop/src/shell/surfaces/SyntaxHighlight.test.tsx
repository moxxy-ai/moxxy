import { render, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { languageForPath, SyntaxCode } from './SyntaxHighlight';

describe('languageForPath', () => {
  it('maps common source names and extensions to their Prism grammars', () => {
    expect(languageForPath('src/App.tsx')).toBe('tsx');
    expect(languageForPath('config/moxxy.yaml')).toBe('yaml');
    expect(languageForPath('Dockerfile')).toBe('docker');
    expect(languageForPath('.env.local')).toBe('properties');
    expect(languageForPath('assets/archive.bin')).toBeNull();
  });
});

describe('SyntaxCode', () => {
  it('loads the selected grammar, keeps line numbers, and preserves source text', async () => {
    const source = 'const answer: number = 42;\nconsole.log(answer);';
    const { container } = render(<SyntaxCode path="src/index.ts" content={source} />);

    await waitFor(() => expect(container.querySelector('.token.keyword')).not.toBeNull());
    expect(container.querySelector('.syntax-code__gutter')?.textContent).toBe('1\n2');
    expect(container.querySelector('.syntax-code__body')?.textContent).toBe(source);
    expect(container.querySelector('.syntax-code')).toHaveAttribute('data-language', 'typescript');
  });

  it('renders markup as React text/tokens rather than executable HTML', async () => {
    const source = '<img src=x onerror="window.pwned=true">';
    const { container } = render(<SyntaxCode path="unsafe.html" content={source} />);

    await waitFor(() => expect(container.querySelector('.token.tag')).not.toBeNull());
    expect(container.querySelector('img')).toBeNull();
    expect(container.textContent).toContain(source);
  });
});
