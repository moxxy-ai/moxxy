/**
 * `latest-mac.yml`: the list electron-builder attaches to a release, naming the
 * macOS archives with their size and SHA-512. Only what the installer needs is
 * read from it, and what it names is checked again once on disk.
 */

import { parse } from 'yaml';

export interface MacArchive {
  /** File name in the release — never a path or an address. */
  readonly name: string;
  /** SHA-512 of the file, base64. */
  readonly sha512: string;
  readonly size: number;
}

export interface MacFeed {
  readonly version: string;
  readonly archives: ReadonlyArray<MacArchive>;
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;

function archiveOf(entry: unknown): MacArchive | null {
  if (!isRecord(entry)) return null;
  const { url, sha512, size } = entry;
  if (typeof url !== 'string' || !/^[^/\\:]+\.zip$/i.test(url)) return null;
  if (typeof sha512 !== 'string' || sha512.length === 0) return null;
  if (typeof size !== 'number' || !Number.isFinite(size) || size <= 0) return null;
  return { name: url, sha512, size };
}

export function parseMacFeed(text: string): MacFeed | null {
  let doc: unknown;
  try {
    doc = parse(text);
  } catch {
    return null;
  }
  if (!isRecord(doc) || typeof doc.version !== 'string' || !Array.isArray(doc.files)) return null;
  const archives = doc.files.map(archiveOf).filter((archive): archive is MacArchive => archive !== null);
  return { version: doc.version, archives };
}

type Build = 'arm64' | 'x64' | 'universal';

/** electron-builder names the arm64 and universal builds; the Intel one has no label. */
function buildOf(name: string): Build {
  if (/universal/i.test(name)) return 'universal';
  return /arm64/i.test(name) ? 'arm64' : 'x64';
}

/** The archive for this processor: its own build, else the universal one. */
export function pickMacArchive(feed: MacFeed, arch: string): MacArchive | null {
  const own: Build = arch === 'arm64' ? 'arm64' : 'x64';
  const of = (build: Build): MacArchive | undefined => feed.archives.find((archive) => buildOf(archive.name) === build);
  return of(own) ?? of('universal') ?? null;
}
