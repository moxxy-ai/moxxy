import { useCallback, useMemo, useState, type MouseEvent } from 'react';
import { api, toErrorMessage } from '@moxxy/client-core';
import { usePopover, type Popover } from '@/shell/menu/usePopover';
import type { MenuEntry } from '@/shell/menu/PopoverMenu';
import { emitAttachment } from '@/shell/WorkspaceFiles';
import { useCopy } from '@/lib/useCopy';
import { linkMenuItems, opensAtOnce, systemOf, type LinkAction, type LinkTarget } from './link-menu';
import { fileFailureLabel, openLocalFile } from './local-file-link';
import { openWebLink } from './web-link';
import { useHasMoxxyBrowser } from './moxxy-browser-context';

const MENU_WIDTH = 224;

export interface LinkMenu {
  readonly popover: Popover<HTMLAnchorElement, HTMLDivElement>;
  readonly entries: ReadonlyArray<MenuEntry>;
  readonly onClick: (event: MouseEvent) => void;
  readonly onContextMenu: (event: MouseEvent) => void;
  /** Said beside the link when the last action failed; `reason` is the host's own words. */
  readonly failure: { readonly label: string; readonly reason: string } | null;
  readonly copied: boolean;
}

/** The file name at the end of a path, from either system's slashes. */
function baseName(path: string): string {
  return path.split(/[\\/]/u).pop() || path;
}

/**
 * A link in the chat: a click opens a menu of what can be done with it, and
 * Cmd-click (Ctrl-click off a Mac) does the usual thing at once — a page in
 * the default browser, a file in its app. The same in the main chat and the
 * mini chat, since both render the transcript through `MarkdownBody`, except
 * that the Mini Chat has no Moxxy browser to offer (`MoxxyBrowserContext`).
 */
export function useLinkMenu(target: LinkTarget): LinkMenu {
  const system = systemOf(typeof navigator === 'undefined' ? '' : navigator.platform);
  const moxxyBrowser = useHasMoxxyBrowser();
  const popover = usePopover<HTMLAnchorElement, HTMLDivElement>({ side: 'bottom', align: 'start', width: MENU_WIDTH });
  const { copied, copy } = useCopy();
  const [failure, setFailure] = useState<LinkMenu['failure']>(null);

  const attempt = useCallback((work: () => Promise<void>) => {
    setFailure(null);
    work().catch((e: unknown) => {
      const reason = toErrorMessage(e);
      setFailure({ label: target.kind === 'file' ? fileFailureLabel(reason) : 'Couldn’t open this link', reason });
    });
  }, [target.kind]);

  const run = useCallback((action: LinkAction): void => {
    switch (action) {
      case 'open-in-moxxy':
        if (target.kind === 'web') attempt(() => api().invoke('browser.showUrl', { url: target.url }));
        return;
      case 'open-in-browser':
        if (target.kind === 'web') attempt(() => openWebLink(target.url));
        return;
      case 'copy-link':
        if (target.kind === 'web') void copy(target.url);
        return;
      case 'open-file':
        if (target.kind === 'file') attempt(() => openLocalFile(target.path));
        return;
      case 'reveal-file':
        if (target.kind === 'file') attempt(() => api().invoke('files.reveal', { path: target.path }));
        return;
      case 'attach-file':
        if (target.kind === 'file') emitAttachment({ path: target.path, name: baseName(target.path) });
        return;
      case 'copy-path':
        if (target.kind === 'file') void copy(target.path);
    }
  }, [target, attempt, copy]);

  const entries = useMemo(
    () => linkMenuItems(target, system, { moxxyBrowser }).map((item) => ({
      id: item.action,
      label: item.label,
      icon: item.icon,
      onSelect: () => run(item.action),
    })),
    [target, system, moxxyBrowser, run],
  );

  const onClick = useCallback((event: MouseEvent): void => {
    event.preventDefault();
    if (opensAtOnce(event, system)) {
      popover.close();
      run(target.kind === 'web' ? 'open-in-browser' : 'open-file');
      return;
    }
    popover.toggle(event);
  }, [system, popover, run, target.kind]);

  const onContextMenu = useCallback((event: MouseEvent): void => {
    event.preventDefault();
    if (!popover.open) popover.toggle(event);
  }, [popover]);

  return { popover, entries, onClick, onContextMenu, failure, copied };
}
