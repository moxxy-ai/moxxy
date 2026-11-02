import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { __setApiOverride } from '@moxxy/client-core';
import { MarkdownBody } from './MarkdownBody';
import { FILE_INSERT_EVENT, type FileInsertDetail } from '@/shell/WorkspaceFiles';

// The test browser (jsdom) reports no platform, which the link menu reads as Linux:
// Ctrl-click is the shortcut that skips the menu.
const SKIP_MENU = { ctrlKey: true };

afterEach(() => {
  cleanup();
  __setApiOverride(null);
});

// Fake IPC transport — the renderer ↔ main boundary.
function installApi(invoke = vi.fn(async (..._args: unknown[]): Promise<unknown> => ({ opened: 'app' }))) {
  __setApiOverride({ invoke, subscribe: () => () => undefined } as never);
  return invoke;
}

// The system clipboard is the other boundary.
let clipboard: string[];
beforeEach(() => {
  clipboard = [];
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText: async (text: string) => void clipboard.push(text) },
    configurable: true,
  });
});

function choose(link: string, item: string): void {
  fireEvent.click(screen.getByRole('link', { name: link }));
  fireEvent.click(screen.getByRole('menuitem', { name: item }));
}

describe('a link to a file on this machine', () => {
  it('opens a menu instead of navigating, and Open opens the file through the host', async () => {
    const invoke = installApi();
    render(<MarkdownBody text="Plik: [ellen-trailer.mp4](file:///Users/me/Downloads/ellen-trailer.mp4)." />);

    const link = screen.getByRole('link', { name: 'ellen-trailer.mp4' });
    expect(link.getAttribute('target')).toBeNull();
    fireEvent.click(link);
    expect(screen.getByRole('menu')).toBeInTheDocument();
    expect(invoke).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Open' }));

    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith('files.open', { path: '/Users/me/Downloads/ellen-trailer.mp4' }),
    );
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('opens at once on the shortcut click, as before the menu', async () => {
    const invoke = installApi();
    render(<MarkdownBody text="[raport](</Users/me/Propozycje YouTube/RECLAIM-RESULTS.md>)" />);

    fireEvent.click(screen.getByRole('link', { name: 'raport' }), SKIP_MENU);

    expect(screen.queryByRole('menu')).toBeNull();
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith('files.open', { path: '/Users/me/Propozycje YouTube/RECLAIM-RESULTS.md' }),
    );
  });

  it('opens the menu on a right click too', () => {
    installApi();
    render(<MarkdownBody text="[raport](/Users/me/a.md)" />);

    fireEvent.contextMenu(screen.getByRole('link', { name: 'raport' }));

    expect(screen.getByRole('menu')).toBeInTheDocument();
  });

  it('shows the file in the file manager', async () => {
    const invoke = installApi(vi.fn(async () => undefined));
    render(<MarkdownBody text="[raport](/Users/me/a.md)" />);

    choose('raport', 'Show in folder');

    await waitFor(() => expect(invoke).toHaveBeenCalledWith('files.reveal', { path: '/Users/me/a.md' }));
  });

  it('adds the file to the message being written', () => {
    installApi();
    const attached: FileInsertDetail[] = [];
    const listen = (e: Event): void => void attached.push((e as CustomEvent<FileInsertDetail>).detail);
    window.addEventListener(FILE_INSERT_EVENT, listen);
    render(<MarkdownBody text="[raport](/Users/me/Notatki/a.md)" />);

    choose('raport', 'Add to agent');

    window.removeEventListener(FILE_INSERT_EVENT, listen);
    expect(attached).toEqual([{ relPath: 'a.md', absPath: '/Users/me/Notatki/a.md', name: 'a.md' }]);
  });

  it('copies the path', async () => {
    installApi();
    render(<MarkdownBody text="[raport](C:/Users/Jan/raport.docx)" />);

    choose('raport', 'Copy path');

    await waitFor(() => expect(clipboard).toEqual(['C:/Users/Jan/raport.docx']));
    expect(await screen.findByText('Copied')).toBeInTheDocument();
  });

  it('opens a linked file on a Windows drive through the host', async () => {
    const invoke = installApi();
    render(<MarkdownBody text="[raport](file:///C:/Users/Jan/raport.docx) i [notatki](C:/Users/Jan/notatki.md)" />);

    fireEvent.click(screen.getByRole('link', { name: 'raport' }), SKIP_MENU);
    fireEvent.click(screen.getByRole('link', { name: 'notatki' }), SKIP_MENU);

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith('files.open', { path: 'C:/Users/Jan/raport.docx' });
      expect(invoke).toHaveBeenCalledWith('files.open', { path: 'C:/Users/Jan/notatki.md' });
    });
  });

  it('says so beside the link when the file cannot be opened', async () => {
    installApi(vi.fn(async () => {
      throw new Error('No application knows how to open this file');
    }));
    render(<MarkdownBody text="[gone](/Users/me/gone.md)" />);

    choose('gone', 'Open');

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Couldn’t open this file');
    expect(alert).toHaveAttribute('title', 'No application knows how to open this file');
  });

  it('says plainly when the linked file is not there', async () => {
    installApi(vi.fn(async () => {
      throw new Error('file not found: C:\\Users\\Jan\\gone.md');
    }));
    render(<MarkdownBody text="[gone](C:/Users/Jan/gone.md)" />);

    choose('gone', 'Open');

    expect(await screen.findByRole('alert')).toHaveTextContent('This file is not there');
  });
});

describe('a link to a web page', () => {
  it('keeps its address and never opens a window of the app', () => {
    installApi();
    render(<MarkdownBody text="[PR](https://github.com/moxxy-ai/moxxy/pull/693)" />);

    const link = screen.getByRole('link', { name: 'PR' });
    expect(link.getAttribute('href')).toBe('https://github.com/moxxy-ai/moxxy/pull/693');
    expect(link.getAttribute('target')).toBeNull();
    const event = new MouseEvent('click', { bubbles: true, cancelable: true });
    link.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
  });

  it('opens in the default browser from the menu', async () => {
    const invoke = installApi(vi.fn(async () => undefined));
    render(<MarkdownBody text="[PR](https://github.com/moxxy-ai/moxxy/pull/693)" />);

    choose('PR', 'Open in browser');

    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith('onboarding.openExternal', { url: 'https://github.com/moxxy-ai/moxxy/pull/693' }),
    );
  });

  it('opens in the default browser at once on the shortcut click', async () => {
    const invoke = installApi(vi.fn(async () => undefined));
    render(<MarkdownBody text="[docs](https://example.com/docs)" />);

    fireEvent.click(screen.getByRole('link', { name: 'docs' }), SKIP_MENU);

    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith('onboarding.openExternal', { url: 'https://example.com/docs' }),
    );
  });

  it('opens in the Moxxy browser from the menu', async () => {
    const invoke = installApi(vi.fn(async () => undefined));
    render(<MarkdownBody text="[docs](https://example.com/docs)" />);

    choose('docs', 'Open in Moxxy browser');

    await waitFor(() => expect(invoke).toHaveBeenCalledWith('browser.showUrl', { url: 'https://example.com/docs' }));
  });

  it('copies the link', async () => {
    installApi();
    render(<MarkdownBody text="[docs](https://example.com/docs)" />);

    choose('docs', 'Copy link');

    await waitFor(() => expect(clipboard).toEqual(['https://example.com/docs']));
  });

  it('says so beside the link when it cannot be opened', async () => {
    installApi(vi.fn(async () => {
      throw new Error('refusing to open unsafe external URL');
    }));
    render(<MarkdownBody text="[docs](https://example.com/docs)" />);

    choose('docs', 'Open in browser');

    expect(await screen.findByRole('alert')).toHaveTextContent('Couldn’t open this link');
  });
});

describe('a link the app cannot open', () => {
  it('reads as plain text rather than a link that does nothing', () => {
    installApi();
    render(<MarkdownBody text="Pisz na [adres](mailto:me@example.com)." />);

    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.getByText('adres')).toBeInTheDocument();
  });
});
