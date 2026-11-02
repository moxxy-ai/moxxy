import type { IconName } from '@moxxy/desktop-ui';
import { localFilePath } from './local-file-link';

/**
 * What a link in the chat can lead to, and what the menu a click on it offers.
 * Pure data, so the same answers hold in the main chat and the mini chat.
 */

export type LinkTarget =
  | { readonly kind: 'web'; readonly url: string }
  | { readonly kind: 'file'; readonly path: string };

export type LinkAction =
  | 'open-in-moxxy'
  | 'open-in-browser'
  | 'copy-link'
  | 'open-file'
  | 'reveal-file'
  | 'attach-file'
  | 'copy-path';

export interface LinkMenuItem {
  readonly action: LinkAction;
  readonly label: string;
  readonly icon: IconName;
}

export type System = 'mac' | 'windows' | 'linux';

const WEB_ADDRESS = /^https?:\/\//iu;

/** The page or file `href` leads to, or null for a link the app does not open (`mailto:`, `javascript:`). */
export function linkTarget(href: string | undefined): LinkTarget | null {
  const path = localFilePath(href);
  if (path) return { kind: 'file', path };
  return href && WEB_ADDRESS.test(href) ? { kind: 'web', url: href } : null;
}

/** The system, from `navigator.platform` ("MacIntel", "Win32", "Linux x86_64"). */
export function systemOf(platform: string): System {
  const name = platform.toLowerCase();
  if (name.includes('mac')) return 'mac';
  if (name.includes('win')) return 'windows';
  return 'linux';
}

/** The file manager by the name its system gives it. */
const REVEAL_LABEL: Readonly<Record<System, string>> = {
  mac: 'Show in Finder',
  windows: 'Show in File Explorer',
  linux: 'Show in folder',
};

export function linkMenuItems(target: LinkTarget, system: System): ReadonlyArray<LinkMenuItem> {
  if (target.kind === 'web') {
    return [
      { action: 'open-in-moxxy', label: 'Open in Moxxy browser', icon: 'globe' },
      { action: 'open-in-browser', label: 'Open in browser', icon: 'link' },
      { action: 'copy-link', label: 'Copy link', icon: 'copy' },
    ];
  }
  return [
    { action: 'open-file', label: 'Open', icon: 'file' },
    { action: 'reveal-file', label: REVEAL_LABEL[system], icon: 'folder' },
    { action: 'attach-file', label: 'Add to agent', icon: 'attach' },
    { action: 'copy-path', label: 'Copy path', icon: 'copy' },
  ];
}

/** Cmd-click on a Mac, Ctrl-click elsewhere: open the link as before, without the menu. */
export function opensAtOnce(event: { readonly metaKey: boolean; readonly ctrlKey: boolean }, system: System): boolean {
  return system === 'mac' ? event.metaKey : event.ctrlKey;
}
