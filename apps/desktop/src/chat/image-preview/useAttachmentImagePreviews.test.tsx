import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useAttachmentImagePreviews } from './useAttachmentImagePreviews';

const invoke = vi.hoisted(() => vi.fn());

vi.mock('@moxxy/client-core', () => ({
  api: () => ({ invoke }),
}));

describe('useAttachmentImagePreviews', () => {
  beforeEach(() => {
    invoke.mockReset();
  });

  it('loads image previews for staged attachments and skips non-images', async () => {
    invoke.mockImplementation(async (cmd: string, args: { path: string; name: string }) => {
      if (cmd !== 'session.previewAttachment') return null;
      if (!args.path.endsWith('.png')) return null;
      return {
        kind: 'image',
        name: args.name,
        mediaType: 'image/png',
        base64: 'AAAA',
        byteLength: 3,
      };
    });

    const { result } = renderHook(() =>
      useAttachmentImagePreviews('workspace-1', [
        { path: '/tmp/screen.png', name: 'screen.png' },
        { path: '/tmp/readme.md', name: 'readme.md' },
      ]),
    );

    await waitFor(() => {
      expect(result.current.get('/tmp/screen.png')).toMatchObject({
        name: 'screen.png',
        mediaType: 'image/png',
        base64: 'AAAA',
      });
    });
    expect(result.current.has('/tmp/readme.md')).toBe(false);
    expect(invoke).toHaveBeenCalledWith('session.previewAttachment', {
      workspaceId: 'workspace-1',
      path: '/tmp/screen.png',
      name: 'screen.png',
    });
  });

  it('removes stale preview entries when an attachment is removed', async () => {
    invoke.mockResolvedValue({
      kind: 'image',
      name: 'screen.png',
      mediaType: 'image/png',
      base64: 'AAAA',
      byteLength: 3,
    });

    const { result, rerender } = renderHook(
      ({ attachments }) => useAttachmentImagePreviews('workspace-1', attachments),
      {
        initialProps: {
          attachments: [{ path: '/tmp/screen.png', name: 'screen.png' }],
        },
      },
    );

    await waitFor(() => expect(result.current.has('/tmp/screen.png')).toBe(true));
    rerender({ attachments: [] });
    await waitFor(() => expect(result.current.has('/tmp/screen.png')).toBe(false));
  });
});
