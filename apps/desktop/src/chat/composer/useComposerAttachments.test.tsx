/**
 * Unit tests for the composer attachment hook + its pure base64 helper.
 *
 * `fileToBase64` strips the `data:` prefix so image bytes ride IPC cleanly;
 * `useComposerAttachments` de-duplicates by path and reacts to the rail's
 * file-insert CustomEvent. Both were buried in `Composer.tsx`; extracting the
 * hook makes the attach path testable without rendering the whole composer.
 */
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// The hook reaches @moxxy/client-core (api()/toErrorMessage) and a `@/shell`
// alias; stub both so the pure attachment logic can be exercised in isolation.
const invoke = vi.hoisted(() => vi.fn());
vi.mock('@moxxy/client-core', () => ({
  api: () => ({ invoke }),
  toErrorMessage: (e: unknown) => String(e),
}));
vi.mock('@/shell/WorkspaceFiles', () => ({
  FILE_INSERT_EVENT: 'moxxy:file-insert',
}));

import { fileToBase64, useComposerAttachments } from './useComposerAttachments';

beforeEach(() => {
  invoke.mockReset();
});

describe('fileToBase64', () => {
  it('strips the data: prefix, returning only the base64 payload', async () => {
    // "hi" → base64 "aGk=".
    const blob = new Blob(['hi'], { type: 'text/plain' });
    const out = await fileToBase64(blob);
    expect(out).toBe('aGk=');
    expect(out).not.toContain(',');
    expect(out).not.toContain('data:');
  });
});

describe('useComposerAttachments', () => {
  it('de-duplicates by path on add', () => {
    const { result } = renderHook(() => useComposerAttachments(() => undefined));
    act(() => result.current.addAttachment({ path: '/a.txt', name: 'a.txt' }));
    act(() => result.current.addAttachment({ path: '/a.txt', name: 'a.txt' }));
    act(() => result.current.addAttachment({ path: '/b.txt', name: 'b.txt' }));
    expect(result.current.attachments.map((a) => a.path)).toEqual(['/a.txt', '/b.txt']);
  });

  it('removes by path and clears all', () => {
    const { result } = renderHook(() => useComposerAttachments(() => undefined));
    act(() => {
      result.current.addAttachment({ path: '/a.txt', name: 'a.txt' });
      result.current.addAttachment({ path: '/b.txt', name: 'b.txt' });
    });
    act(() => result.current.removeAttachment('/a.txt'));
    expect(result.current.attachments.map((a) => a.path)).toEqual(['/b.txt']);
    act(() => result.current.clearAttachments());
    expect(result.current.attachments).toEqual([]);
  });

  it('stages a file from the rail file-insert event', () => {
    const { result } = renderHook(() => useComposerAttachments(() => undefined));
    act(() => {
      window.dispatchEvent(
        new CustomEvent('moxxy:file-insert', { detail: { absPath: '/x/y.md', name: 'y.md' } }),
      );
    });
    expect(result.current.attachments).toEqual([{ path: '/x/y.md', name: 'y.md' }]);
  });

  it('ignores a file-insert event with no absPath', () => {
    const { result } = renderHook(() => useComposerAttachments(() => undefined));
    act(() => {
      window.dispatchEvent(new CustomEvent('moxxy:file-insert', { detail: { name: 'y.md' } }));
    });
    expect(result.current.attachments).toEqual([]);
  });

  it('pastes image files through the save-image IPC and leaves text paste untouched', async () => {
    invoke.mockResolvedValue({ path: '/tmp/pasted.png', name: 'pasted.png' });
    const focusInput = vi.fn();
    const { result } = renderHook(() => useComposerAttachments(focusInput));
    const image = new File(['png bytes'], 'pasted.png', { type: 'image/png' });
    const imageEvent = {
      preventDefault: vi.fn(),
      clipboardData: {
        items: [
          {
            kind: 'file',
            type: 'image/png',
            getAsFile: () => image,
          },
        ],
      },
    };

    act(() => result.current.onPaste(imageEvent as never));

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith('session.saveImageAttachment', {
        dataBase64: expect.any(String),
        mediaType: 'image/png',
        name: 'pasted.png',
      });
      expect(result.current.attachments).toEqual([{ path: '/tmp/pasted.png', name: 'pasted.png' }]);
    });
    expect(imageEvent.preventDefault).toHaveBeenCalledOnce();
    expect(focusInput).toHaveBeenCalledOnce();

    const textEvent = {
      preventDefault: vi.fn(),
      clipboardData: { items: [{ kind: 'string', type: 'text/plain' }] },
    };
    act(() => result.current.onPaste(textEvent as never));
    expect(textEvent.preventDefault).not.toHaveBeenCalled();
  });
});
