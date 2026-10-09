import { describe, expect, it } from 'vitest';
import { assertDefined } from '@moxxy/sdk';

import { parseMacFeed, pickMacArchive } from './mac-feed';

/** `latest-mac.yml` as electron-builder attached it to desktop-v0.42.0. */
const RELEASED = `version: 0.42.0
files:
  - url: moxxy-desktop-0.42.0-universal.zip
    sha512: GY0j6bDPOIzpKj1iZJBfZnb+zBjXaxEiFIqmRoaHtoA02q9EuB7A8dk+xZp3r2gB+hzaHcll8kz4fSx1DZ+LxQ==
    size: 1120384708
  - url: moxxy-desktop-0.42.0-universal.dmg
    sha512: h8FrCVQbUcEgIh5sAVDlRTmVxlC5NWLaFbIGDIqQejO9UoCsreCYK2BJYTODdF1UxmfKCBhHStpZoYCKPPe+5Q==
    size: 1134714841
path: moxxy-desktop-0.42.0-universal.zip
sha512: GY0j6bDPOIzpKj1iZJBfZnb+zBjXaxEiFIqmRoaHtoA02q9EuB7A8dk+xZp3r2gB+hzaHcll8kz4fSx1DZ+LxQ==
releaseDate: '2026-10-09T12:58:18.933Z'
`;

const zip = (name: string): string => `  - url: ${name}\n    sha512: c2hh\n    size: 10\n`;

describe('parseMacFeed', () => {
  it('reads the version and the zip archives of a released feed', () => {
    expect(parseMacFeed(RELEASED)).toEqual({
      version: '0.42.0',
      archives: [
        {
          name: 'moxxy-desktop-0.42.0-universal.zip',
          sha512: 'GY0j6bDPOIzpKj1iZJBfZnb+zBjXaxEiFIqmRoaHtoA02q9EuB7A8dk+xZp3r2gB+hzaHcll8kz4fSx1DZ+LxQ==',
          size: 1120384708,
        },
      ],
    });
  });

  it('refuses a feed that is not one', () => {
    expect(parseMacFeed('<html>Not Found</html>')).toBeNull();
    expect(parseMacFeed('version: 1.0.0\n')).toBeNull();
    expect(parseMacFeed('files:\n' + zip('a.zip'))).toBeNull();
  });

  it('leaves out an archive named with a path or an address', () => {
    const feed = parseMacFeed(
      'version: 1.0.0\nfiles:\n' + zip('../a.zip') + zip('https://elsewhere.example/a.zip') + zip('dir/a.zip') + zip('ok.zip'),
    );
    expect(feed?.archives.map((archive) => archive.name)).toEqual(['ok.zip']);
  });

  it('leaves out an archive without a size or a checksum', () => {
    const feed = parseMacFeed('version: 1.0.0\nfiles:\n  - url: a.zip\n    size: 10\n  - url: b.zip\n    sha512: c2hh\n' + zip('ok.zip'));
    expect(feed?.archives.map((archive) => archive.name)).toEqual(['ok.zip']);
  });
});

describe('pickMacArchive', () => {
  const feedOf = (...names: string[]): NonNullable<ReturnType<typeof parseMacFeed>> => {
    const feed = parseMacFeed('version: 1.0.0\nfiles:\n' + names.map(zip).join(''));
    assertDefined(feed, 'the test feed parses');
    return feed;
  };

  it('takes the one archive there is, whatever the processor', () => {
    const feed = feedOf('app-universal.zip');
    expect(pickMacArchive(feed, 'arm64')?.name).toBe('app-universal.zip');
    expect(pickMacArchive(feed, 'x64')?.name).toBe('app-universal.zip');
  });

  it('takes the archive built for this processor when there is one for each', () => {
    const feed = feedOf('app-arm64.zip', 'app-x64.zip');
    expect(pickMacArchive(feed, 'arm64')?.name).toBe('app-arm64.zip');
    expect(pickMacArchive(feed, 'x64')?.name).toBe('app-x64.zip');
  });

  it('prefers the universal archive over one for another processor', () => {
    const feed = feedOf('app-arm64.zip', 'app-universal.zip');
    expect(pickMacArchive(feed, 'x64')?.name).toBe('app-universal.zip');
  });

  it('has nothing to take from a feed for another processor only', () => {
    expect(pickMacArchive(feedOf('app-arm64.zip'), 'x64')).toBeNull();
  });
});
