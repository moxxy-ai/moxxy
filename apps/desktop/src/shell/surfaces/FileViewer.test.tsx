import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { __setApiOverride } from '@moxxy/client-core';
import type { MoxxyApi } from '@moxxy/desktop-ipc-contract';
import { FileViewer } from './FileViewer';

const originalCreateObjectURL = URL.createObjectURL;
const originalRevokeObjectURL = URL.revokeObjectURL;

beforeEach(() => {
  Object.defineProperty(URL, 'createObjectURL', {
    configurable: true,
    value: vi.fn(() => 'blob:moxxy-preview'),
  });
  Object.defineProperty(URL, 'revokeObjectURL', {
    configurable: true,
    value: vi.fn(),
  });
});

afterEach(() => {
  cleanup();
  __setApiOverride(null);
  Object.defineProperty(URL, 'createObjectURL', {
    configurable: true,
    value: originalCreateObjectURL,
  });
  Object.defineProperty(URL, 'revokeObjectURL', {
    configurable: true,
    value: originalRevokeObjectURL,
  });
});

function installResult(result: unknown): void {
  __setApiOverride({
    invoke: async () => result,
    subscribe: () => () => {},
  } as unknown as MoxxyApi);
}

describe('FileViewer previews', () => {
  it('renders Markdown safely and lets the user return to highlighted source', async () => {
    installResult({
      path: 'README.md',
      kind: 'text',
      content: '# Hello\n\n<script>window.pwned=true</script>',
      truncated: true,
      text: true,
      byteLength: 48,
    });
    const { container } = render(
      <FileViewer workspaceId="ws" path="README.md" mode="content" />,
    );

    expect(await screen.findByRole('heading', { name: 'Hello' })).toBeInTheDocument();
    expect(container.querySelector('script')).toBeNull();
    expect(screen.getByText('… (truncated)')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Source' }));
    await waitFor(() => expect(container.querySelector('.token.title')).not.toBeNull());
    expect(container.querySelector('.syntax-code')).toHaveAttribute('data-language', 'markdown');
  });

  it('frames PDFs with fit controls and a local download action', async () => {
    installResult({
      path: 'docs/guide.pdf',
      kind: 'pdf',
      content: '',
      truncated: false,
      text: false,
      byteLength: 2_048,
      mediaType: 'application/pdf',
      base64: 'JVBERi0=',
    });
    render(<FileViewer workspaceId="ws" path="docs/guide.pdf" mode="content" />);

    const frame = await screen.findByTitle('docs/guide.pdf');
    expect(frame).toHaveAttribute('src', expect.stringContaining('#view=FitH'));
    expect(screen.getByRole('link', { name: 'Download' })).toHaveAttribute('download', 'guide.pdf');
    fireEvent.click(screen.getByRole('button', { name: 'Fit page' }));
    expect(screen.getByTitle('docs/guide.pdf')).toHaveAttribute('src', expect.stringContaining('#view=Fit&'));
  });

  it('opens audio through a non-autoplay Blob preview', async () => {
    installResult({
      path: 'voice.mp3',
      kind: 'media',
      content: '',
      truncated: false,
      text: false,
      byteLength: 3,
      mediaType: 'audio/mpeg',
      base64: 'SUQz',
    });
    const { container } = render(
      <FileViewer workspaceId="ws" path="voice.mp3" mode="content" />,
    );

    await waitFor(() => expect(container.querySelector('audio')).not.toBeNull());
    expect(container.querySelector('audio')).not.toHaveAttribute('autoplay');
    expect(container.querySelector('source')).toHaveAttribute('src', 'blob:moxxy-preview');
    expect(container.querySelector('source')).toHaveAttribute('type', 'audio/mpeg');
  });
});
