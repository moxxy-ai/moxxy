/**
 * Unit tests for the composer attachment hook + its pure base64 helper.
 *
 * `fileToBase64` strips the `data:` prefix so image bytes ride IPC cleanly;
 * `useComposerAttachments` de-duplicates by path and reacts to the rail's
 * file-insert CustomEvent. Both were buried in `Composer.tsx`; extracting the
 * hook makes the attach path testable without rendering the whole composer.
 */
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

// The hook reaches @moxxy/client-core (api()/toErrorMessage) and a `@/shell`
// alias; stub both so the pure attachment logic can be exercised in isolation.
vi.mock('@moxxy/client-core', () => ({
  api: () => ({ invoke: vi.fn() }),
  toErrorMessage: (e: unknown) => String(e),
}));
vi.mock('@/shell/WorkspaceFiles', () => ({
  FILE_INSERT_EVENT: 'moxxy:file-insert',
}));

import { fileToBase64, useComposerAttachments } from './useComposerAttachments';

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
});
