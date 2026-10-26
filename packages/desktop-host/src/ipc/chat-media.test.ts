import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({ ipcMain: { handle: () => undefined } }));

import type { IpcCommandName } from '@moxxy/desktop-ipc-contract';
import type { CommandBus } from '@moxxy/desktop-ipc-contract/bus';
import { removeDir } from '@moxxy/vitest-preset/fs';
import type { DeskStore } from '../desks';
import { ChatMediaStore } from '../chat-media/store';
import { registerChatMediaHandlers, watchChatMediaCleanup } from './chat-media';
import { EventBus } from '../event-bus';
import { setActiveBus } from './shared';

type Handler = (args: unknown) => Promise<unknown>;

const SESSION = '01JMEDIAIPC000000000000000';
const STRANGER = '01JSTRANGER000000000000000';

let tmp: string;
let handlers: Map<string, Handler>;
let opened: string[];
let revealed: string[];

const call = (command: string, args: unknown): Promise<unknown> => {
  const handler = handlers.get(command);
  if (!handler) throw new Error(`${command} was not registered`);
  return handler(args);
};

async function writeLog(sessionId: string, events: ReadonlyArray<Record<string, unknown>>): Promise<void> {
  const lines = events.map((body, seq) =>
    JSON.stringify({ id: `e${seq}`, seq, ts: 100 + seq, sessionId, turnId: 't', source: 'model', ...body }),
  );
  await fs.writeFile(path.join(tmp, 'sessions', `${sessionId}.jsonl`), `${lines.join('\n')}\n`);
}

const PNG = Buffer.from('a picture').toString('base64');

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'mox-chat-media-ipc-'));
  await fs.mkdir(path.join(tmp, 'sessions'));
  opened = [];
  revealed = [];
  handlers = new Map();
  setActiveBus({
    handle: (channel: IpcCommandName, handler: Handler) => handlers.set(channel, handler),
  } as unknown as CommandBus);
  const desks = {
    deskForSession: async (id: string) => (id === SESSION ? { id: 'desk-1' } : null),
  } as unknown as DeskStore;
  const store = new ChatMediaStore({
    sessionsDir: path.join(tmp, 'sessions'),
    cacheDir: path.join(tmp, 'cache'),
    thumbnail: async () => null,
  });
  // Electron's `shell` is the one external boundary — recorded, not executed.
  registerChatMediaHandlers(desks, store, {
    openPath: async (p) => {
      opened.push(p);
      return '';
    },
    showItemInFolder: (p) => void revealed.push(p),
  });
  await writeLog(SESSION, [
    {
      type: 'user_prompt',
      text: 'my photo and contract',
      attachments: [
        { kind: 'image', content: PNG, name: 'me.png', mediaType: 'image/png' },
        {
          kind: 'document',
          content: Buffer.from('%PDF').toString('base64'),
          name: 'Umowa.pdf',
          mediaType: 'application/pdf',
        },
        { kind: 'file', content: 'echo hi', name: 'run.sh' },
      ],
    },
    { type: 'assistant_message', content: 'Read https://docs.example/guide', stopReason: 'end_turn' },
  ]);
  await writeLog(STRANGER, [
    { type: 'assistant_message', content: 'https://secret.example', stopReason: 'end_turn' },
  ]);
});

afterEach(async () => {
  await removeDir(tmp);
});

describe('chat media IPC', () => {
  it('removes cached media when a chat is deleted from the registry', async () => {
    const store = new ChatMediaStore({
      sessionsDir: path.join(tmp, 'sessions'),
      cacheDir: path.join(tmp, 'cache'),
      thumbnail: async () => null,
    });
    await store.library(SESSION);
    const bus = new EventBus();
    const stop = watchChatMediaCleanup(store, bus);
    try {
      await fs.rm(path.join(tmp, 'sessions', `${SESSION}.jsonl`));
      bus.broadcast('desks.changed', { desks: [], activeId: null });
      await vi.waitFor(async () => expect(await fs.readdir(path.join(tmp, 'cache'))).toEqual([]));
    } finally {
      stop();
    }
  });
  it("lists a chat's photos, files and links without their bytes", async () => {
    const library = (await call('chat.media', { workspaceId: SESSION })) as {
      items: Array<{ kind: string; id: string }>;
    };
    expect(library.items.map((item) => [item.kind, item.id])).toEqual([
      ['link', 'l:https://docs.example/guide'],
      ['file', 'a:0:2'],
      ['file', 'a:0:1'],
      ['image', 'a:0:0'],
    ]);
    expect(JSON.stringify(library)).not.toContain(PNG);
  });

  it('serves nothing from a chat that is not one of this desktop', async () => {
    expect(await call('chat.media', { workspaceId: STRANGER })).toBeNull();
    expect(await call('chat.mediaThumbnail', { workspaceId: STRANGER, id: 'a:0:0' })).toBeNull();
    expect(await call('chat.readMediaImage', { workspaceId: STRANGER, id: 'a:0:0', offset: 0 })).toBeNull();
    await expect(call('chat.openMediaFile', { workspaceId: STRANGER, id: 'a:0:1' })).rejects.toThrow();
    expect(opened).toEqual([]);
  });

  it('reads an image in slices with its type', async () => {
    expect(await call('chat.readMediaImage', { workspaceId: SESSION, id: 'a:0:0', offset: 0 })).toEqual({
      mediaType: 'image/png',
      data: PNG,
      total: PNG.length,
    });
    expect(await call('chat.readMediaImage', { workspaceId: SESSION, id: 'a:0:0', offset: 8 })).toEqual({
      mediaType: 'image/png',
      data: PNG.slice(8),
      total: PNG.length,
    });
  });

  it('opens an attached document with its app, and only shows a script in its folder', async () => {
    expect(await call('chat.openMediaFile', { workspaceId: SESSION, id: 'a:0:1' })).toEqual({
      opened: 'app',
    });
    expect(opened.map((p) => path.basename(p))).toEqual(['Umowa.pdf']);
    expect(await call('chat.openMediaFile', { workspaceId: SESSION, id: 'a:0:2' })).toEqual({
      opened: 'folder',
    });
    expect(revealed.map((p) => path.basename(p))).toEqual(['run.sh']);
  });

  it('refuses to open what is not a file of the library', async () => {
    await expect(
      call('chat.openMediaFile', { workspaceId: SESSION, id: 'l:https://docs.example/guide' }),
    ).rejects.toThrow();
    await expect(call('chat.openMediaFile', { workspaceId: SESSION, id: 'a:0:0' })).rejects.toThrow();
  });
});
