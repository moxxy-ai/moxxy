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

  it('keeps web links opening in the browser', () => {
    installApi();
    render(<MarkdownBody text="[docs](https://example.com/docs)" />);

    const link = screen.getByRole('link', { name: 'docs' });
    expect(link.getAttribute('href')).toBe('https://example.com/docs');
    expect(link.getAttribute('target')).toBe('_blank');
  });
});
