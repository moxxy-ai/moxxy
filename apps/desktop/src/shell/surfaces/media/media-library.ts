import type { ChatMediaItem, ChatMediaLink } from '@moxxy/desktop-ipc-contract';

/** The library's three shelves. */
export type MediaKind = ChatMediaItem['kind'];
/** Whose items show: everyone's, the person's, or the agent's. */
export type MediaOwnerFilter = 'all' | 'me' | 'agent';

export interface MediaFilter {
  readonly kind: MediaKind;
  readonly owner: MediaOwnerFilter;
  readonly query: string;
}

/** The items of one shelf, by owner, holding every word of the query. */
export function filterMedia(items: ReadonlyArray<ChatMediaItem>, filter: MediaFilter): ChatMediaItem[] {
  const words = fold(filter.query).split(/\s+/).filter(Boolean);
  return items.filter(
    (item) =>
      item.kind === filter.kind &&
      (filter.owner === 'all' || item.owner === filter.owner) &&
      (words.length === 0 || matches(item, words)),
  );
}

function matches(item: ChatMediaItem, words: ReadonlyArray<string>): boolean {
  const haystack = fold(searchableText(item));
  return words.every((word) => haystack.includes(word));
}

function searchableText(item: ChatMediaItem): string {
  switch (item.kind) {
    case 'image':
      return `${item.name ?? ''} ${item.caption}`;
    case 'file':
      return `${item.name} ${item.path ?? ''} ${item.caption}`;
    case 'link':
      return `${item.url} ${item.label ?? ''} ${item.caption}`;
  }
}

/** Lower case without accents, so "zdjecie" finds "Zdjęcie". */
function fold(text: string): string {
  return text.normalize('NFD').replace(/\p{M}/gu, '').replace(/ł/g, 'l').replace(/Ł/g, 'l').toLowerCase();
}

export interface MonthGroup<T> {
  readonly key: string;
  readonly label: string;
  readonly items: ReadonlyArray<T>;
}

/** Newest-first items under their month; the year is named only when it is not this one. */
export function groupByMonth<T extends { readonly ts: number }>(
  items: ReadonlyArray<T>,
  now: Date,
): Array<MonthGroup<T>> {
  const groups: Array<{ key: string; label: string; items: T[] }> = [];
  for (const item of items) {
    const date = new Date(item.ts);
    const key = `${date.getFullYear()}-${date.getMonth()}`;
    const last = groups[groups.length - 1];
    if (last && last.key === key) {
      last.items.push(item);
      continue;
    }
    const month = date.toLocaleString('en-US', { month: 'long' });
    groups.push({
      key,
      label: date.getFullYear() === now.getFullYear() ? month : `${month} ${date.getFullYear()}`,
      items: [item],
    });
  }
  return groups;
}

/** A short date: "Oct 19", or "Mar 4, 2025" in another year. */
export function mediaDate(ts: number, now: Date): string {
  const date = new Date(ts);
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    ...(date.getFullYear() === now.getFullYear() ? {} : { year: 'numeric' }),
  });
}

/** Where a link goes, without `www.`. */
export function linkHost(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

/** A link's own words, or where it goes: host and path, without the trailing slash. */
export function linkTitle(item: ChatMediaLink): string {
  if (item.label) return item.label;
  try {
    const url = new URL(item.url);
    return `${linkHost(item.url)}${url.pathname}`.replace(/\/+$/, '');
  } catch {
    return item.url;
  }
}
