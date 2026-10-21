import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { appendFile, mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { MoxxyEvent } from '@moxxy/sdk';
import { removeDir } from '@moxxy/vitest-preset/fs';
import { ChatMediaStore, type Thumbnailer } from './store';

const SESSION = '01JCHATMEDIA0000000000000A';

let root: string;
let sessionsDir: string;
let cacheDir: string;
let seq: number;

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'moxxy-chat-media-'));
  sessionsDir = path.join(root, 'sessions');
  cacheDir = path.join(root, 'cache', 'chat-media');
  await mkdir(sessionsDir, { recursive: true });
  seq = 0;
});

afterEach(async () => {
  await removeDir(root);
});

function event(body: Record<string, unknown>): MoxxyEvent {
  const n = seq++;
  return {
    id: `e${n}`,
    seq: n,
    ts: 1_000 + n,
    sessionId: SESSION,
    turnId: 't',
    source: 'model',
    ...body,
  } as unknown as MoxxyEvent;
}

const logPath = (): string => path.join(sessionsDir, `${SESSION}.jsonl`);

async function append(...events: MoxxyEvent[]): Promise<void> {
  await appendFile(logPath(), events.map((e) => `${JSON.stringify(e)}\n`).join(''));
}

const say = (content: string): MoxxyEvent =>
  event({ type: 'assistant_message', content, stopReason: 'end_turn' });
const png = (text: string): string => Buffer.from(text).toString('base64');

/** Stands in for Electron's image resizing at the host boundary. */
const halve: Thumbnailer = async (bytes) => ({
  mediaType: 'image/jpeg',
  bytes: bytes.subarray(0, Math.ceil(bytes.length / 2)),
});

const urls = async (store: ChatMediaStore): Promise<string[]> =>
  (await store.library(SESSION)).flatMap((entry) => (entry.item.kind === 'link' ? [entry.item.url] : []));

describe('ChatMediaStore', () => {
  it('replaces extracted attachments after clearing a chat and reusing its sequence numbers', async () => {
    const attach = (text: string) =>
      event({
        type: 'user_prompt',
        text: '',
        attachments: [{ kind: 'file', name: 'report.txt', content: text }],
      });
    await append(attach('old'));
    const store = new ChatMediaStore({ sessionsDir, cacheDir, thumbnail: halve });
    const oldFile = await store.file(SESSION, 'a:0:0');
    expect(oldFile).not.toBeNull();
    seq = 0;
    await writeFile(logPath(), '');
    await append(attach('new report content'));
    const newFile = await store.file(SESSION, 'a:0:0');
    expect(newFile).not.toBeNull();
    expect(await readFile(newFile ?? '', 'utf8')).toBe('new report content');
  });

  it('recovers from a syntactically valid but malformed cached entry', async () => {
    await append(say('https://safe.example'));
    const store = new ChatMediaStore({ sessionsDir, cacheDir, thumbnail: halve });
    await store.library(SESSION);
    const indexPath = path.join(cacheDir, SESSION, 'index.json');
    const index = JSON.parse(await readFile(indexPath, 'utf8'));
    index.state.entries = [['bad', {}]];
    await writeFile(indexPath, JSON.stringify(index));
    expect(await urls(new ChatMediaStore({ sessionsDir, cacheDir, thumbnail: halve }))).toEqual([
      'https://safe.example/',
    ]);
  });
  it('reads a log once, then only what was appended since', async () => {
    await append(say('first https://one.example'));
    const store = new ChatMediaStore({ sessionsDir, cacheDir, thumbnail: halve });
    expect(await urls(store)).toEqual(['https://one.example/']);

    await append(
      event({ type: 'assistant_chunk', delta: 'https://chunk.example' }),
      say('then https://two.example'),
    );
    expect(await urls(store)).toEqual(['https://two.example/', 'https://one.example/']);

    const index = JSON.parse(await readFile(path.join(cacheDir, SESSION, 'index.json'), 'utf8')) as {
      logSize: number;
    };
    expect(index.logSize).toBe((await stat(logPath())).size);
  });

  it('keeps the index across restarts and goes on from it', async () => {
    await append(say('https://one.example'));
    await new ChatMediaStore({ sessionsDir, cacheDir, thumbnail: halve }).library(SESSION);
    await append(say('https://two.example'));
    expect(await urls(new ChatMediaStore({ sessionsDir, cacheDir, thumbnail: halve }))).toEqual([
      'https://two.example/',
      'https://one.example/',
    ]);
  });

  it('leaves a half-written last line for the next read', async () => {
    await append(say('https://one.example'));
    const half = JSON.stringify(say('https://two.example'));
    await appendFile(logPath(), half.slice(0, 20));
    const store = new ChatMediaStore({ sessionsDir, cacheDir, thumbnail: halve });
    expect(await urls(store)).toEqual(['https://one.example/']);
    await appendFile(logPath(), `${half.slice(20)}\n`);
    expect(await urls(store)).toEqual(['https://two.example/', 'https://one.example/']);
  });

  it('skips a corrupt line and keeps the rest', async () => {
    await append(say('https://one.example'));
    await appendFile(logPath(), '{"not json\n');
    await append(say('https://two.example'));
    expect(await urls(new ChatMediaStore({ sessionsDir, cacheDir, thumbnail: halve }))).toEqual([
      'https://two.example/',
      'https://one.example/',
    ]);
  });

  it('starts over when the chat was cleared, even once the new log outgrew the old one', async () => {
    await append(say('old https://old.example'));
    const store = new ChatMediaStore({ sessionsDir, cacheDir, thumbnail: halve });
    expect(await urls(store)).toEqual(['https://old.example/']);

    await writeFile(logPath(), '');
    seq = 0;
    await append(
      say(
        'a much longer new conversation about https://new.example and more words to grow past the old size',
      ),
    );
    expect(await urls(store)).toEqual(['https://new.example/']);
  });

  it('serves an image and a small copy of it, and keeps the copy', async () => {
    await append(
      event({ type: 'tool_call_requested', callId: 'c1', name: 'browser_capture', input: {} }),
      event({
        type: 'tool_result',
        callId: 'c1',
        ok: true,
        output: { mediaType: 'image/png', base64: png('0123456789') },
      }),
    );
    let made = 0;
    const store = new ChatMediaStore({
      sessionsDir,
      cacheDir,
      thumbnail: async (bytes, mediaType) => {
        made += 1;
        return halve(bytes, mediaType);
      },
    });
    const [entry] = await store.library(SESSION);
    expect(entry?.item.id).toBe('t:1:0');

    expect(await store.image(SESSION, 't:1:0')).toEqual({
      mediaType: 'image/png',
      base64: png('0123456789'),
    });
    expect(await store.thumbnail(SESSION, 't:1:0')).toEqual({
      mediaType: 'image/jpeg',
      base64: png('01234'),
    });
    expect(
      await new ChatMediaStore({ sessionsDir, cacheDir, thumbnail: halve }).thumbnail(SESSION, 't:1:0'),
    ).toEqual({
      mediaType: 'image/jpeg',
      base64: png('01234'),
    });
    expect(made).toBe(1);
  });

  it('draws a small image whole when it cannot be resized', async () => {
    await append(
      event({
        type: 'user_prompt',
        text: '',
        attachments: [{ kind: 'image', content: png('gif'), name: 'a.gif', mediaType: 'image/gif' }],
      }),
    );
    const store = new ChatMediaStore({ sessionsDir, cacheDir, thumbnail: async () => null });
    expect(await store.thumbnail(SESSION, 'a:0:0')).toEqual({ mediaType: 'image/gif', base64: png('gif') });
  });

  it('answers null for an id the chat does not hold', async () => {
    await append(say('nothing here'));
    const store = new ChatMediaStore({ sessionsDir, cacheDir, thumbnail: halve });
    expect(await store.image(SESSION, 't:0:0')).toBeNull();
    expect(await store.thumbnail(SESSION, 'a:9:0')).toBeNull();
    expect(await store.file(SESSION, 'a:9:0')).toBeNull();
  });

  it('writes an attached file out once under its own name, and points at a linked file where it is', async () => {
    await append(
      event({
        type: 'user_prompt',
        text: 'here',
        attachments: [
          {
            kind: 'document',
            content: png('%PDF-1.7'),
            name: '/Users/me/Umowa.pdf',
            mediaType: 'application/pdf',
          },
          { kind: 'file', content: 'plain notes', name: 'notes.txt' },
        ],
      }),
      say('Saved [it](/Users/me/report.pdf)'),
    );
    const store = new ChatMediaStore({ sessionsDir, cacheDir, thumbnail: halve });
    const pdf = await store.file(SESSION, 'a:0:0');
    expect(pdf && path.basename(pdf)).toBe('Umowa.pdf');
    expect(pdf && (await readFile(pdf, 'utf8'))).toBe('%PDF-1.7');
    const notes = await store.file(SESSION, 'a:0:1');
    expect(notes && (await readFile(notes, 'utf8'))).toBe('plain notes');
    expect(await store.file(SESSION, 'f:/Users/me/report.pdf')).toBe('/Users/me/report.pdf');
  });

  it('gives a linked file its size while it is on the disk', async () => {
    const real = path.join(root, 'real.txt');
    await writeFile(real, 'twelve bytes');
    await append(say(`[a](${real}) and [b](${path.join(root, 'gone.txt')})`));
    const library = await new ChatMediaStore({ sessionsDir, cacheDir, thumbnail: halve }).library(SESSION);
    expect(
      library.map((entry) => (entry.item.kind === 'file' ? [entry.item.name, entry.item.bytes] : null)),
    ).toEqual([
      ['gone.txt', null],
      ['real.txt', 12],
    ]);
  });

  it("reads the startup chat, whose id is '__unbound__'", async () => {
    await appendFile(path.join(sessionsDir, '__unbound__.jsonl'), `${JSON.stringify(say('https://one.example'))}\n`);
    const store = new ChatMediaStore({ sessionsDir, cacheDir, thumbnail: halve });
    expect((await store.library('__unbound__')).map((entry) => entry.item.id)).toEqual(['l:https://one.example/']);
  });

  it('refuses a session id that could leave the sessions folder', async () => {
    const store = new ChatMediaStore({ sessionsDir, cacheDir, thumbnail: halve });
    await expect(store.library('../../etc')).rejects.toThrow();
  });

  it('forgets the index of a chat whose log is gone', async () => {
    await append(say('https://one.example'));
    const store = new ChatMediaStore({ sessionsDir, cacheDir, thumbnail: halve });
    await store.library(SESSION);
    await rm(logPath());
    await store.sweep();
    expect(existsSync(path.join(cacheDir, SESSION))).toBe(false);
    expect(await readdir(cacheDir)).toEqual([]);
  });
});
