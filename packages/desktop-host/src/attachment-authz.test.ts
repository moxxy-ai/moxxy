import { describe, expect, it, beforeEach } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';

import {
  authorizeAttachments,
  rememberPickedAttachment,
  __resetPickedAttachments,
} from './attachment-authz';

let root: string;

beforeEach(() => {
  __resetPickedAttachments();
  root = mkdtempSync(path.join(os.tmpdir(), 'attach-'));
});

function file(rel: string): string {
  const abs = path.join(root, rel);
  mkdirSync(path.dirname(abs), { recursive: true });
  writeFileSync(abs, 'x');
  return abs;
}

describe('authorizeAttachments', () => {
  it('allows a path under the workspace cwd', async () => {
    const cwd = path.join(root, 'workspace');
    const inside = file('workspace/notes.txt');
    const { authorized, dropped } = await authorizeAttachments(
      [{ path: inside, name: 'notes.txt' }],
      [cwd],
    );
    expect(authorized).toHaveLength(1);
    expect(dropped).toEqual([]);
  });

  it('drops a path outside the workspace cwd that was never picked', async () => {
    const cwd = path.join(root, 'workspace');
    mkdirSync(cwd, { recursive: true });
    const secret = file('outside/id_rsa');
    const { authorized, dropped } = await authorizeAttachments(
      [{ path: secret, name: 'id_rsa' }],
      [cwd],
    );
    expect(authorized).toEqual([]);
    expect(dropped).toEqual(['id_rsa']);
  });

  it('allows an outside path once it has been picked via the native dialog', async () => {
    const cwd = path.join(root, 'workspace');
    mkdirSync(cwd, { recursive: true });
    const picked = file('outside/diagram.png');
    await rememberPickedAttachment(picked);
    const { authorized, dropped } = await authorizeAttachments(
      [{ path: picked, name: 'diagram.png' }],
      [cwd],
    );
    expect(authorized).toHaveLength(1);
    expect(dropped).toEqual([]);
  });

  it('drops a non-existent path', async () => {
    const { authorized, dropped } = await authorizeAttachments(
      [{ path: path.join(root, 'ghost.txt'), name: 'ghost.txt' }],
      [root],
    );
    expect(authorized).toEqual([]);
    expect(dropped).toEqual(['ghost.txt']);
  });
});
