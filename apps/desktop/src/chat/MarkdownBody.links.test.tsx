import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { __setApiOverride } from '@moxxy/client-core';
import { MarkdownBody } from './MarkdownBody';

afterEach(() => {
  cleanup();
  __setApiOverride(null);
});

// Fake IPC transport — the renderer ↔ main boundary.
function installApi() {
  const invoke = vi.fn(async () => ({ opened: 'app' }));
  __setApiOverride({ invoke, subscribe: () => () => undefined } as never);
  return invoke;
}

describe('MarkdownBody links', () => {
  it('opens a linked local file through the host instead of navigating', async () => {
    const invoke = installApi();
    render(<MarkdownBody text="Plik: [ellen-trailer.mp4](file:///Users/me/Downloads/ellen-trailer.mp4)." />);

    const link = screen.getByRole('link', { name: 'ellen-trailer.mp4' });
    expect(link.getAttribute('target')).toBeNull();
    fireEvent.click(link);

    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith('files.open', { path: '/Users/me/Downloads/ellen-trailer.mp4' }),
    );
  });

  it('opens a linked path with a space in a folder name as that path', async () => {
    const invoke = installApi();
    render(<MarkdownBody text="[raport](</Users/me/Propozycje YouTube/RECLAIM-RESULTS.md>)" />);

    fireEvent.click(screen.getByRole('link', { name: 'raport' }));

    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith('files.open', { path: '/Users/me/Propozycje YouTube/RECLAIM-RESULTS.md' }),
    );
  });

  it('says so beside the link when the file cannot be opened', async () => {
    const invoke = vi.fn(async () => {
      throw new Error('file not found: /Users/me/gone.md');
    });
    __setApiOverride({ invoke, subscribe: () => () => undefined } as never);
    render(<MarkdownBody text="[gone](/Users/me/gone.md)" />);

    fireEvent.click(screen.getByRole('link', { name: 'gone' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Couldn’t open this file');
    expect(alert).toHaveAttribute('title', 'file not found: /Users/me/gone.md');
  });

  it('keeps web links opening in the browser', () => {
    installApi();
    render(<MarkdownBody text="[docs](https://example.com/docs)" />);

    const link = screen.getByRole('link', { name: 'docs' });
    expect(link.getAttribute('href')).toBe('https://example.com/docs');
    expect(link.getAttribute('target')).toBe('_blank');
  });
});
