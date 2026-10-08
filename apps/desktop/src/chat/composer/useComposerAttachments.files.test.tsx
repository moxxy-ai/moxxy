import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { __setApiOverride } from '@moxxy/client-core';
import { ATTACHMENT_LIMITS } from '@moxxy/desktop-ipc-contract';
import { FILE_INSERT_EVENT } from '@/shell/WorkspaceFiles';
import { emitDroppedFiles } from './dropped-files';
import { useComposerAttachments } from './useComposerAttachments';

/**
 * Every way a file reaches the composer either stages it or says why not,
 * where the person can see it, before the prompt is sent.
 */

/** Every call across the IPC boundary, the one thing replaced: there is no Electron main here. */
let calls: Array<[string, unknown]>;
/** What the host answers `session.checkAttachment` with, by path. */
let refused: Record<string, string>;
let saveFails: string | null;

beforeEach(() => {
  calls = [];
  refused = {};
  saveFails = null;
  __setApiOverride({
    invoke: async (name: string, args: { path?: string; name?: string }) => {
      calls.push([name, args]);
      if (name === 'session.checkAttachment') return refused[args.path ?? ''] ?? null;
      if (name === 'session.pickAttachment') return '/Users/me/Desktop/picked.mov';
      if (name === 'session.saveAttachment' || name === 'session.saveImageAttachment') {
        if (saveFails) throw new Error(saveFails);
        return { path: `/tmp/moxxy/${args.name}`, name: args.name };
      }
      return undefined;
    },
    subscribe: () => () => {},
  } as never);
});

afterEach(() => __setApiOverride(null));

const sent = (name: string) => calls.filter(([call]) => call === name).map(([, args]) => args);
const file = (name: string, type: string, body = 'x') => new File([body], name, { type });
/** A file as large as `size` says, without the bytes: the size is all that is read of it. */
function sized(name: string, type: string, size: number): File {
  const big = file(name, type);
  Object.defineProperty(big, 'size', { value: size });
  return big;
}
const drop = (files: File[], folders: string[] = []) => act(() => emitDroppedFiles({ files, folders }));
const mount = () => renderHook(() => useComposerAttachments(() => undefined)).result;

describe('files dropped on the chat', () => {
  it('stages a dropped file of any kind, sent to the host as its bytes and its name', async () => {
    const hook = mount();

    drop([file('figures.csv', 'text/csv', 'a,b\n')]);

    await waitFor(() => expect(hook.current.attachments).toEqual([{ path: '/tmp/moxxy/figures.csv', name: 'figures.csv' }]));
    expect(sent('session.saveAttachment')).toEqual([{ dataBase64: btoa('a,b\n'), name: 'figures.csv' }]);
    expect(hook.current.attachError).toBeNull();
  });

  it('stages a dropped image the way a pasted one is staged', async () => {
    const hook = mount();

    drop([file('shot.png', 'image/png')]);

    await waitFor(() => expect(hook.current.attachments.map((a) => a.name)).toEqual(['shot.png']));
    expect(sent('session.saveImageAttachment')).toEqual([{ dataBase64: btoa('x'), mediaType: 'image/png', name: 'shot.png' }]);
  });

  it('refuses a file over the limit before reading it, and says its size and the limit', async () => {
    const hook = mount();

    drop([sized('holiday.png', 'image/png', ATTACHMENT_LIMITS.imageBytes + 1)]);

    await waitFor(() => expect(hook.current.attachError).toBe('holiday.png is 8.1 MB. An image can be up to 8 MB.'));
    expect(calls).toEqual([]);
    expect(hook.current.attachments).toEqual([]);
  });

  it('stages the files that fit and names the ones that do not', async () => {
    const hook = mount();

    drop([file('notes.md', 'text/markdown'), sized('dump.sql', '', 80 * 1024 * 1024)], ['assets']);

    await waitFor(() => expect(hook.current.attachments.map((a) => a.name)).toEqual(['notes.md']));
    expect(hook.current.attachError).toBe(
      'assets is a folder. Attach the files inside it. dump.sql is 80 MB. A file can be up to 32 MB.',
    );
  });

  it('says what the host said when it would not take the file', async () => {
    saveFails = 'figures.csv is empty.';
    const hook = mount();

    drop([file('figures.csv', 'text/csv')]);

    await waitFor(() => expect(hook.current.attachError).toBe('figures.csv is empty.'));
    expect(hook.current.attachments).toEqual([]);
  });

  it('keeps the refusal until it is dismissed, and drops it when the next file goes in', async () => {
    const hook = mount();
    drop([sized('holiday.png', 'image/png', ATTACHMENT_LIMITS.imageBytes + 1)]);
    await waitFor(() => expect(hook.current.attachError).not.toBeNull());

    act(() => hook.current.dismissAttachError());
    expect(hook.current.attachError).toBeNull();

    drop([sized('holiday.png', 'image/png', ATTACHMENT_LIMITS.imageBytes + 1)]);
    await waitFor(() => expect(hook.current.attachError).not.toBeNull());
    drop([file('shot.png', 'image/png')]);
    await waitFor(() => expect(hook.current.attachments).toHaveLength(1));
    expect(hook.current.attachError).toBeNull();
  });
});

describe('a file pasted from the file manager', () => {
  const paste = (hook: ReturnType<typeof mount>, files: File[]) => {
    const prevented = { count: 0 };
    act(() =>
      hook.current.onPaste({
        preventDefault: () => (prevented.count += 1),
        clipboardData: { items: files.map((f) => ({ kind: 'file', type: f.type, getAsFile: () => f })) },
      } as never),
    );
    return prevented;
  };

  it('is staged whatever its kind, instead of being pasted as nothing', async () => {
    const hook = mount();

    const prevented = paste(hook, [file('report.pdf', 'application/pdf')]);

    await waitFor(() => expect(hook.current.attachments.map((a) => a.name)).toEqual(['report.pdf']));
    expect(sent('session.saveAttachment')).toHaveLength(1);
    expect(prevented.count).toBe(1);
  });

  it('is refused aloud when it is too large', async () => {
    const hook = mount();

    paste(hook, [sized('film.mov', 'video/quicktime', 2 * 1024 * 1024 * 1024)]);

    await waitFor(() => expect(hook.current.attachError).toBe('film.mov is 2 GB. A file can be up to 32 MB.'));
    expect(calls).toEqual([]);
  });
});

describe('a file named by its path', () => {
  const insert = (absPath: string, name: string) =>
    act(() => {
      window.dispatchEvent(new CustomEvent(FILE_INSERT_EVENT, { detail: { absPath, relPath: name, name } }));
    });

  it('is asked of the host first, and staged when the host would attach it', async () => {
    const hook = mount();

    insert('/ws/src/index.ts', 'index.ts');

    await waitFor(() => expect(hook.current.attachments).toEqual([{ path: '/ws/src/index.ts', name: 'index.ts' }]));
    expect(sent('session.checkAttachment')).toEqual([{ path: '/ws/src/index.ts', name: 'index.ts' }]);
  });

  it('is not staged when the host would leave it out of the prompt, and the reason is shown', async () => {
    refused['/ws/assets/film.mov'] = 'film.mov is 70 MB. Only plain text can be attached at that size.';
    const hook = mount();

    insert('/ws/assets/film.mov', 'film.mov');

    await waitFor(() =>
      expect(hook.current.attachError).toBe('film.mov is 70 MB. Only plain text can be attached at that size.'),
    );
    expect(hook.current.attachments).toEqual([]);
  });

  it('is checked the same way when it comes from the file picker', async () => {
    refused['/Users/me/Desktop/picked.mov'] = 'picked.mov is not a kind of file Moxxy can read.';
    const hook = mount();

    await act(() => hook.current.onAttach());

    expect(hook.current.attachError).toBe('picked.mov is not a kind of file Moxxy can read.');
    expect(hook.current.attachments).toEqual([]);
  });
});
