import { describe, expect, it } from 'vitest';
import type { ChatMediaItem, ChatMediaLink } from '@moxxy/desktop-ipc-contract';
import { filterMedia, groupByMonth, linkHost, linkTitle, mediaDate } from './media-library';

const at = (iso: string): number => new Date(iso).getTime();

const image = (
  id: string,
  owner: 'me' | 'agent',
  ts: number,
  caption = '',
  name: string | null = null,
): ChatMediaItem => ({
  kind: 'image',
  id,
  owner,
  seq: 1,
  ts,
  caption,
  mediaType: 'image/png',
  name,
  bytes: 10,
});

const link = (url: string, label: string | null = null, caption = ''): ChatMediaLink => ({
  kind: 'link',
  id: `l:${url}`,
  owner: 'agent',
  seq: 1,
  ts: at('2026-10-01T10:00:00'),
  caption,
  url,
  label,
});

const file = (name: string, owner: 'me' | 'agent'): ChatMediaItem => ({
  kind: 'file',
  id: `f:${name}`,
  owner,
  seq: 1,
  ts: at('2026-10-01T10:00:00'),
  caption: '',
  name,
  mediaType: null,
  bytes: 5,
  path: `/tmp/${name}`,
});

describe('filterMedia', () => {
  const items = [
    image('i1', 'me', 1, 'koncert w Spodku', 'plakat.png'),
    image('i2', 'agent', 2, 'browser_capture https://shop.example/cart'),
    link('https://tickets.example/visual-concert', 'Bilety na koncert'),
    file('Umowa.pdf', 'me'),
    file('report.md', 'agent'),
  ];

  it('keeps one kind', () => {
    expect(filterMedia(items, { kind: 'image', owner: 'all', query: '' }).map((item) => item.id)).toEqual([
      'i1',
      'i2',
    ]);
  });

  it("keeps the person's or the agent's", () => {
    expect(filterMedia(items, { kind: 'file', owner: 'me', query: '' }).map((item) => item.id)).toEqual([
      'f:Umowa.pdf',
    ]);
    expect(filterMedia(items, { kind: 'image', owner: 'agent', query: '' }).map((item) => item.id)).toEqual([
      'i2',
    ]);
  });

  it('finds by any word in the name, the address or the words around it, ignoring case and accents', () => {
    expect(
      filterMedia(items, { kind: 'image', owner: 'all', query: 'SPODEK koncert' }).map((item) => item.id),
    ).toEqual([]);
    expect(
      filterMedia(items, { kind: 'image', owner: 'all', query: 'spodku Koncert' }).map((item) => item.id),
    ).toEqual(['i1']);
    expect(
      filterMedia(items, { kind: 'image', owner: 'all', query: 'shop.example' }).map((item) => item.id),
    ).toEqual(['i2']);
    expect(
      filterMedia(items, { kind: 'link', owner: 'all', query: 'bilety' }).map((item) => item.id),
    ).toEqual(['l:https://tickets.example/visual-concert']);
    expect(filterMedia(items, { kind: 'file', owner: 'all', query: 'umowa' }).map((item) => item.id)).toEqual(
      ['f:Umowa.pdf'],
    );
    expect(
      filterMedia([image('x', 'me', 1, 'Zdjęcie z wakacji')], {
        kind: 'image',
        owner: 'all',
        query: 'zdjecie',
      }),
    ).toHaveLength(1);
  });
});

describe('groupByMonth', () => {
  const now = new Date('2026-10-20T12:00:00');

  it('groups newest first under the month, naming the year only when it is not this one', () => {
    const groups = groupByMonth(
      [
        image('a', 'me', at('2026-10-19T10:00:00')),
        image('b', 'me', at('2026-10-02T10:00:00')),
        image('c', 'me', at('2026-09-30T10:00:00')),
        image('d', 'me', at('2025-12-24T10:00:00')),
      ],
      now,
    );
    expect(groups.map((group) => [group.label, group.items.map((item) => item.id)])).toEqual([
      ['October', ['a', 'b']],
      ['September', ['c']],
      ['December 2025', ['d']],
    ]);
  });
});

describe('links and dates', () => {
  it('titles a link by its own words, or by where it goes', () => {
    expect(linkTitle(link('https://tickets.example/visual', 'Bilety'))).toBe('Bilety');
    expect(linkTitle(link('https://www.example.com/docs/guide/'))).toBe('example.com/docs/guide');
    expect(linkTitle(link('https://example.com/'))).toBe('example.com');
    expect(linkHost('https://www.youtube.com/watch?v=1')).toBe('youtube.com');
  });

  it('dates an item briefly, with the year only when it is not this one', () => {
    const now = new Date('2026-10-20T12:00:00');
    expect(mediaDate(at('2026-10-19T10:00:00'), now)).toBe('Oct 19');
    expect(mediaDate(at('2025-03-04T10:00:00'), now)).toBe('Mar 4, 2025');
  });
});
