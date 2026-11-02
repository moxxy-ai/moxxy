import type { AnchorHTMLAttributes } from 'react';
import { PopoverMenu } from '@/shell/menu/PopoverMenu';
import type { LinkTarget } from './link-menu';
import { useLinkMenu } from './useLinkMenu';

const LINK_STYLE: React.CSSProperties = {
  color: 'var(--color-reference)',
  textDecoration: 'underline',
  textUnderlineOffset: '0.15em',
};

const NOTE_STYLE: React.CSSProperties = {
  marginLeft: '0.4em',
  fontSize: 'var(--type-meta)',
};

/**
 * A link the agent wrote, to a page or to a file on this machine. Never
 * followed by the webview itself: a click opens the link menu (see
 * {@link useLinkMenu}), and what went wrong, or that it was copied, is said
 * beside it.
 */
export function ChatLink({
  link,
  node: _node,
  target: _target,
  ...anchor
}: AnchorHTMLAttributes<HTMLAnchorElement> & { readonly link: LinkTarget; readonly node?: unknown }): JSX.Element {
  const menu = useLinkMenu(link);
  return (
    <>
      <a
        {...anchor}
        ref={menu.popover.anchorRef}
        title={link.kind === 'file' ? link.path : link.url}
        rel="noreferrer noopener"
        aria-haspopup="menu"
        aria-expanded={menu.popover.open}
        onClick={menu.onClick}
        onContextMenu={menu.onContextMenu}
        // Reference, not the accent. The accent means the human commanded it; a
        // link the agent cited is reference data, which is what this hue is for.
        style={LINK_STYLE}
      />
      <PopoverMenu popover={menu.popover} label="Link" entries={menu.entries} />
      {menu.failure && (
        <span role="alert" title={menu.failure.reason} style={{ ...NOTE_STYLE, color: 'var(--color-red)' }}>
          {menu.failure.label}
        </span>
      )}
      {menu.copied && (
        <span role="status" style={{ ...NOTE_STYLE, color: 'var(--color-text-muted)' }}>
          Copied
        </span>
      )}
    </>
  );
}
