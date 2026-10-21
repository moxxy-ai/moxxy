/**
 * Each chat's media library, kept as an index beside its log under
 * `~/.moxxy/cache/chat-media/<sessionId>/` so a year-long chat is not read from
 * its first line every time the pane opens.
 *
 * The log stays the truth. The index records how many bytes of the log it has
 * read and a fingerprint of the log's first line; a later read goes on from
 * there, and a log that shrank or begins differently (the chat was cleared)
 * is read again from the start. Bytes are never copied into the index: an
 * image is read back from its event's line when a thumbnail or a preview asks,
 * and a line that no longer holds the event it should is a reason to rebuild.
 *
 * Reads and writes of one chat run one after another, so two panes asking at
 * once cannot write the index over each other.
 */

import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, open, readdir, readFile, rm, stat, type FileHandle } from 'node:fs/promises';
import path from 'node:path';
import { isMoxxyEventShape, defaultSessionsDir } from '@moxxy/core';
import { toolImagesOf, type MoxxyEvent } from '@moxxy/sdk';
import { moxxyPath, writeFileAtomic } from '@moxxy/sdk/server';
import type { ChatMediaImageData } from '@moxxy/desktop-ipc-contract';
import {
  ChatMediaCollector,
  type ChatMediaEntry,
  type ChatMediaState,
  type ImageFingerprint,
} from './collect';

/** Makes a small copy of an image, or null when it cannot (a type Electron does not decode). */
export type Thumbnailer = (
  bytes: Buffer,
  mediaType: string,
) => Promise<{ readonly mediaType: string; readonly bytes: Buffer } | null>;

export interface ChatMediaStoreOptions {
  readonly sessionsDir?: string;
  readonly cacheDir?: string;
  readonly thumbnail: Thumbnailer;
  /** Lets the agent's screenshots of one screen show once; without it only identical bytes merge. */
  readonly fingerprint?: ImageFingerprint;
}

interface Loaded {
  readonly collector: ChatMediaCollector;
  /** Bytes of the log read so far; always the end of a whole line. */
  logSize: number;
  /** Fingerprint of the log's first line, to notice a cleared chat. */
  head: string;
}

interface IndexFile {
  readonly logSize: number;
  readonly head: string;
  readonly state: ChatMediaState;
}

/** Only these events can add to the library; the rest are skipped unparsed. */
const WANTED_TYPES = ['user_prompt', 'assistant_message', 'tool_call_requested', 'tool_result'].map((type) =>
  Buffer.from(`"type":"${type}"`),
);
const READ_CHUNK = 1024 * 1024;
const HEAD_BYTES = 64 * 1024;
/** An image Electron cannot shrink is drawn whole up to this size. */
const WHOLE_THUMBNAIL_MAX_BYTES = 1536 * 1024;
const SAFE_SESSION_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;

export class ChatMediaStore {
  private readonly sessionsDir: string;
  private readonly cacheDir: string;
  private readonly makeThumbnail: Thumbnailer;
  private readonly fingerprint: ImageFingerprint | undefined;
  private readonly loaded = new Map<string, Loaded>();
  private readonly queues = new Map<string, Promise<unknown>>();

  constructor(options: ChatMediaStoreOptions) {
    this.sessionsDir = options.sessionsDir ?? defaultSessionsDir();
    this.cacheDir = options.cacheDir ?? moxxyPath('cache', 'chat-media');
    this.makeThumbnail = options.thumbnail;
    this.fingerprint = options.fingerprint;
  }

  /** The chat's library, newest first, with the size of each linked file still on the disk. */
  async library(sessionId: string): Promise<ChatMediaEntry[]> {
    const entries = await this.serial(sessionId, async () =>
      (await this.catchUp(sessionId)).collector.entries(),
    );
    return Promise.all(entries.map(withFileSize));
  }

  async image(sessionId: string, id: string): Promise<ChatMediaImageData | null> {
    return this.serial(sessionId, () => this.readImage(sessionId, id));
  }

  async thumbnail(sessionId: string, id: string): Promise<ChatMediaImageData | null> {
    return this.serial(sessionId, async () => {
      const image = await this.readImage(sessionId, id);
      if (!image) return null;
      const name = createHash('sha1').update(image.base64).digest('hex').slice(0, 20);
      const dir = path.join(this.sessionCache(sessionId), 'thumbs');
      for (const [ext, mediaType] of THUMB_TYPES) {
        const kept = await readFile(path.join(dir, `${name}.${ext}`)).catch(() => null);
        if (kept) return { mediaType, base64: kept.toString('base64') };
      }
      const bytes = Buffer.from(image.base64, 'base64');
      const small = await this.makeThumbnail(bytes, image.mediaType).catch(() => null);
      if (!small) return bytes.length <= WHOLE_THUMBNAIL_MAX_BYTES ? image : null;
      const ext = THUMB_TYPES.find(([, mediaType]) => mediaType === small.mediaType)?.[0];
      if (ext) {
        await mkdir(dir, { recursive: true });
        await writeFileAtomic(path.join(dir, `${name}.${ext}`), small.bytes);
      }
      return { mediaType: small.mediaType, base64: small.bytes.toString('base64') };
    });
  }

  /**
   * A path to open for a library file: where a linked file is, or a copy of an
   * attached one written out once under the cache, with its own name.
   */
  async file(sessionId: string, id: string): Promise<string | null> {
    return this.serial(sessionId, async () => {
      const found = await this.find(sessionId, id);
      if (!found || found.entry.item.kind !== 'file') return null;
      if (found.entry.item.path) return found.entry.item.path;
      const event = await this.readEvent(sessionId, found.entry);
      const att = event?.type === 'user_prompt' ? event.attachments?.[found.entry.index] : undefined;
      if (!att) return null;
      const target = path.join(
        this.sessionCache(sessionId),
        'files',
        `${found.entry.item.seq}-${found.entry.index}-${createHash('sha256').update(att.content).digest('hex').slice(0, 20)}`,
        safeFileName(found.entry.item.name),
      );
      if (!existsSync(target)) {
        await mkdir(path.dirname(target), { recursive: true });
        await writeFileAtomic(
          target,
          att.kind === 'file' || att.kind === 'stdin'
            ? Buffer.from(att.content, 'utf8')
            : Buffer.from(att.content, 'base64'),
        );
      }
      return target;
    });
  }

  /** Drop the index of every chat whose log is gone (a removed chat, from any surface). */
  async sweep(): Promise<void> {
    const names = await readdir(this.cacheDir).catch(() => [] as string[]);
    for (const name of names) {
      if (!SAFE_SESSION_ID.test(name)) continue;
      if (existsSync(path.join(this.sessionsDir, `${name}.jsonl`))) continue;
      await this.serial(name, async () => {
        this.loaded.delete(name);
        await rm(path.join(this.cacheDir, name), { recursive: true, force: true });
      });
    }
  }

  // ---------- reading the log -------------------------------------------------

  private async catchUp(sessionId: string): Promise<Loaded> {
    const log = this.logPath(sessionId);
    const info = await stat(log).catch(() => null);
    let current = this.loaded.get(sessionId) ?? (await this.readIndex(sessionId)) ?? this.fresh();
    if (!info) {
      current = this.fresh();
      this.loaded.set(sessionId, current);
      return current;
    }
    const head = await firstLineFingerprint(log);
    if (current.logSize > info.size || (current.logSize > 0 && current.head !== head)) current = this.fresh();
    this.loaded.set(sessionId, current);
    if (info.size > current.logSize) {
      const before = current.logSize;
      current.logSize = await scan(log, current.logSize, info.size, current.collector);
      current.head = head;
      if (current.logSize !== before) await this.writeIndex(sessionId, current);
    }
    return current;
  }

  private async find(sessionId: string, id: string): Promise<{ readonly entry: ChatMediaEntry } | null> {
    const current = await this.catchUp(sessionId);
    const entry = current.collector.entries().find((candidate) => candidate.item.id === id);
    return entry ? { entry } : null;
  }

  /**
   * The event behind an entry, read from its line. A line that holds another
   * event means the log was rewritten under the index: rebuild, and look once
   * more.
   */
  private async readEvent(
    sessionId: string,
    entry: ChatMediaEntry,
    retry = true,
  ): Promise<MoxxyEvent | null> {
    const event = await readLine(this.logPath(sessionId), entry.at.offset, entry.at.length);
    if (event && event.seq === entry.item.seq) return event;
    if (!retry) return null;
    this.loaded.set(sessionId, this.fresh());
    await rm(this.indexPath(sessionId), { force: true });
    const again = await this.find(sessionId, entry.item.id);
    return again ? this.readEvent(sessionId, again.entry, false) : null;
  }

  private async readImage(sessionId: string, id: string): Promise<ChatMediaImageData | null> {
    const found = await this.find(sessionId, id);
    if (!found || found.entry.item.kind !== 'image') return null;
    const { entry } = found;
    const event = await this.readEvent(sessionId, entry);
    if (event?.type === 'user_prompt') {
      const att = event.attachments?.[entry.index];
      return att && att.mediaType ? { mediaType: att.mediaType, base64: att.content } : null;
    }
    if (event?.type === 'tool_result') {
      const image = toolImagesOf(event.output)?.images[entry.index];
      return image ? { mediaType: image.mediaType, base64: image.base64 } : null;
    }
    return null;
  }

  private fresh(): Loaded {
    return {
      collector: new ChatMediaCollector(undefined, { fingerprint: this.fingerprint }),
      logSize: 0,
      head: '',
    };
  }

  // ---------- the index file --------------------------------------------------

  private async readIndex(sessionId: string): Promise<Loaded | null> {
    try {
      const raw = JSON.parse(await readFile(this.indexPath(sessionId), 'utf8')) as Partial<IndexFile>;
      if (
        !Number.isSafeInteger(raw.logSize) ||
        typeof raw.logSize !== 'number' ||
        raw.logSize < 0 ||
        typeof raw.head !== 'string'
      )
        return null;
      return {
        collector: ChatMediaCollector.fromJSON(raw.state, { fingerprint: this.fingerprint }),
        logSize: raw.logSize,
        head: raw.head,
      };
    } catch {
      // Missing or unreadable: read the log again.
      return null;
    }
  }

  private async writeIndex(sessionId: string, current: Loaded): Promise<void> {
    const body: IndexFile = {
      logSize: current.logSize,
      head: current.head,
      state: current.collector.toJSON(),
    };
    await mkdir(this.sessionCache(sessionId), { recursive: true });
    await writeFileAtomic(this.indexPath(sessionId), JSON.stringify(body));
  }

  // ---------- paths and order -------------------------------------------------

  private logPath(sessionId: string): string {
    return path.join(this.sessionsDir, `${sessionId}.jsonl`);
  }

  private sessionCache(sessionId: string): string {
    return path.join(this.cacheDir, sessionId);
  }

  private indexPath(sessionId: string): string {
    return path.join(this.sessionCache(sessionId), 'index.json');
  }

  private serial<T>(sessionId: string, run: () => Promise<T>): Promise<T> {
    if (!SAFE_SESSION_ID.test(sessionId))
      return Promise.reject(new Error(`invalid session id: ${sessionId}`));
    const previous = this.queues.get(sessionId) ?? Promise.resolve();
    const next = previous.then(run, run);
    const settled = next.catch(() => undefined);
    this.queues.set(sessionId, settled);
    void settled.then(() => {
      if (this.queues.get(sessionId) === settled) this.queues.delete(sessionId);
    });
    return next;
  }
}

const THUMB_TYPES: ReadonlyArray<readonly [string, string]> = [
  ['jpg', 'image/jpeg'],
  ['png', 'image/png'],
];

async function withFileSize(entry: ChatMediaEntry): Promise<ChatMediaEntry> {
  const { item } = entry;
  if (item.kind !== 'file' || item.path === null) return entry;
  const info = await stat(item.path).catch(() => null);
  return { ...entry, item: { ...item, bytes: info?.isFile() ? info.size : null } };
}

/** Feed the whole lines of `[from, to)` to the collector; returns where the last whole line ends. */
async function scan(log: string, from: number, to: number, collector: ChatMediaCollector): Promise<number> {
  const handle = await open(log, 'r');
  try {
    let consumed = from;
    let pending: Buffer[] = [];
    let pendingStart = from;
    let position = from;
    while (position < to) {
      const chunk = Buffer.alloc(Math.min(READ_CHUNK, to - position));
      const { bytesRead } = await handle.read(chunk, 0, chunk.length, position);
      if (bytesRead === 0) break;
      const data = chunk.subarray(0, bytesRead);
      let lineStart = 0;
      let newline = data.indexOf(0x0a, lineStart);
      while (newline !== -1) {
        const piece = data.subarray(lineStart, newline);
        const line = pending.length > 0 ? Buffer.concat([...pending, piece]) : piece;
        consumeLine(line, pendingStart, collector);
        pending = [];
        pendingStart = position + newline + 1;
        consumed = pendingStart;
        lineStart = newline + 1;
        newline = data.indexOf(0x0a, lineStart);
      }
      if (lineStart < data.length) pending.push(Buffer.from(data.subarray(lineStart)));
      position += bytesRead;
    }
    return consumed;
  } finally {
    await handle.close();
  }
}

function consumeLine(line: Buffer, offset: number, collector: ChatMediaCollector): void {
  if (!WANTED_TYPES.some((marker) => line.includes(marker))) return;
  let parsed: unknown;
  try {
    parsed = JSON.parse(line.toString('utf8'));
  } catch {
    // A corrupt or half-written line: the rest of the log still counts.
    return;
  }
  if (isMoxxyEventShape(parsed)) collector.add(parsed, { offset, length: line.length });
}

async function readLine(log: string, offset: number, length: number): Promise<MoxxyEvent | null> {
  let handle: FileHandle | null = null;
  try {
    handle = await open(log, 'r');
    const buffer = Buffer.alloc(length);
    const { bytesRead } = await handle.read(buffer, 0, length, offset);
    const parsed: unknown = JSON.parse(buffer.subarray(0, bytesRead).toString('utf8'));
    return isMoxxyEventShape(parsed) ? parsed : null;
  } catch {
    return null;
  } finally {
    await handle?.close();
  }
}

async function firstLineFingerprint(log: string): Promise<string> {
  const handle = await open(log, 'r');
  try {
    const buffer = Buffer.alloc(HEAD_BYTES);
    const { bytesRead } = await handle.read(buffer, 0, HEAD_BYTES, 0);
    const data = buffer.subarray(0, bytesRead);
    const newline = data.indexOf(0x0a);
    // Only a whole first line is a fingerprint; a log still writing its first
    // line has none yet, and nothing has been read from it either.
    if (newline === -1) return '';
    return createHash('sha1').update(data.subarray(0, newline)).digest('hex');
  } finally {
    await handle.close();
  }
}

/** A name every file system takes: no separators, no characters Windows refuses. */
function safeFileName(name: string): string {
  const cleaned = path
    .basename(name)
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_')
    .trim();
  return cleaned === '' || cleaned === '.' || cleaned === '..' ? 'file' : cleaned;
}
