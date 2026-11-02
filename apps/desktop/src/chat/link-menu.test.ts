import { describe, expect, it } from 'vitest';
import { linkMenuItems, linkTarget, opensAtOnce, systemOf } from './link-menu';

describe('linkTarget', () => {
  it('is a web page for an http(s) address', () => {
    expect(linkTarget('https://github.com/moxxy-ai/moxxy')).toEqual({ kind: 'web', url: 'https://github.com/moxxy-ai/moxxy' });
  });

  it('is a file for a path on this machine, from any system', () => {
    expect(linkTarget('file:///Users/me/a.md')).toEqual({ kind: 'file', path: '/Users/me/a.md' });
    expect(linkTarget('C:\\Users\\Jan\\a.docx')).toEqual({ kind: 'file', path: 'C:\\Users\\Jan\\a.docx' });
  });

  it('is nothing for a link the app does not open', () => {
    expect(linkTarget('mailto:me@example.com')).toBeNull();
    expect(linkTarget('javascript:alert(1)')).toBeNull();
    expect(linkTarget(undefined)).toBeNull();
  });
});

describe('systemOf', () => {
  it('names the system from the browser platform', () => {
    expect(systemOf('MacIntel')).toBe('mac');
    expect(systemOf('Win32')).toBe('windows');
    expect(systemOf('Linux x86_64')).toBe('linux');
  });
});

describe('linkMenuItems', () => {
  it('offers the Moxxy browser, the default browser and copying for a web page', () => {
    expect(linkMenuItems({ kind: 'web', url: 'https://a.b' }, 'mac').map((item) => item.label)).toEqual([
      'Open in Moxxy browser',
      'Open in browser',
      'Copy link',
    ]);
  });

  it('offers opening, the file manager of this system, attaching and copying for a file', () => {
    const labels = (system: 'mac' | 'windows' | 'linux') =>
      linkMenuItems({ kind: 'file', path: '/a/b.md' }, system).map((item) => item.label);
    expect(labels('mac')).toEqual(['Open', 'Show in Finder', 'Add to agent', 'Copy path']);
    expect(labels('windows')).toContain('Show in File Explorer');
    expect(labels('linux')).toContain('Show in folder');
  });
});

describe('opensAtOnce', () => {
  it('skips the menu on Cmd-click on a Mac and Ctrl-click elsewhere', () => {
    expect(opensAtOnce({ metaKey: true, ctrlKey: false }, 'mac')).toBe(true);
    expect(opensAtOnce({ metaKey: false, ctrlKey: true }, 'mac')).toBe(false);
    expect(opensAtOnce({ metaKey: false, ctrlKey: true }, 'windows')).toBe(true);
    expect(opensAtOnce({ metaKey: false, ctrlKey: false }, 'linux')).toBe(false);
  });
});
