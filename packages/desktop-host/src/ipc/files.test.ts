import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({ ipcMain: { handle: () => undefined } }));

import type { IpcCommandName } from '@moxxy/desktop-ipc-contract';
import type { CommandBus } from '@moxxy/desktop-ipc-contract/bus';
import { setActiveBus } from './shared';
import { registerFilesHandlers } from './files';

type Handler = (...args: unknown[]) => Promise<unknown>;

let tmp: string;
let opened: string[];
let revealed: string[];
let open: (p: string) => Promise<unknown>;

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'mox-files-'));
  opened = [];
  revealed = [];
  const handlers = new Map<string, Handler>();
  setActiveBus({
    handle: (channel: IpcCommandName, handler: Handler) => handlers.set(channel, handler),
  } as unknown as CommandBus);
  // Electron's `shell` is the one external boundary — recorded, not executed.
  registerFilesHandlers({
    openPath: async (p) => {
      opened.push(p);
      return '';
    },
    showItemInFolder: (p) => void revealed.push(p),
  });
  const handler = handlers.get('files.open');
  if (!handler) throw new Error('files.open was not registered');
  open = (p) => handler({ path: p });
});

afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});

async function file(name: string): Promise<string> {
  const p = path.join(tmp, name);
  await fs.writeFile(p, 'x');
  return p;
}

describe('files.open (a local file link in the chat)', () => {
  it('opens a video with its default app', async () => {
    const clip = await file('trailer.mp4');

    await expect(open(clip)).resolves.toEqual({ opened: 'app' });
    expect(opened).toEqual([clip]);
  });

  it('only shows a runnable file in Finder, never runs it', async () => {
    const script = await file('install.command');

    await expect(open(script)).resolves.toEqual({ opened: 'folder' });
    expect(opened).toEqual([]);
    expect(revealed).toEqual([script]);
  });

  it('shows a folder (or an app bundle) in Finder', async () => {
    const bundle = path.join(tmp, 'Tool.app');
    await fs.mkdir(bundle);

    await expect(open(bundle)).resolves.toEqual({ opened: 'folder' });
    expect(opened).toEqual([]);
    expect(revealed).toEqual([bundle]);
  });

  it('says so when the file is gone', async () => {
    await expect(open(path.join(tmp, 'missing.mp4'))).rejects.toThrow(/not found/u);
  });

  it('refuses a relative path', async () => {
    await expect(open('clip.mp4')).rejects.toThrow(/absolute/u);
  });
});
