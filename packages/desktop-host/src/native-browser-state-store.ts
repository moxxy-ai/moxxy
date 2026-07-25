import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from '@moxxy/sdk';

import type { PersistedNativeBrowserWorkspace } from './native-browser-state.js';

const safeId = z.string().min(1).max(256).regex(/^[A-Za-z0-9_.-]+$/);
const persistedUrl = z.string().max(16_384).refine((value) => {
  if (value === 'about:blank') return true;
  try {
    const url = new URL(value);
    return (
      (url.protocol === 'http:' || url.protocol === 'https:') &&
      url.username === '' &&
      url.password === ''
    );
  } catch {
    return false;
  }
}, 'invalid persisted browser URL');
const tabSchema = z.object({ id: safeId, url: persistedUrl }).strict();
const workspaceSchema = z
  .object({
    workspaceId: safeId,
    activeTabId: safeId,
    tabs: z.array(tabSchema).min(1).max(64),
  })
  .strict()
  .superRefine((workspace, ctx) => {
    const ids = new Set<string>();
    for (const tab of workspace.tabs) {
      if (ids.has(tab.id)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['tabs'], message: 'duplicate tab id' });
      }
      ids.add(tab.id);
    }
    if (!ids.has(workspace.activeTabId)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['activeTabId'], message: 'unknown active tab' });
    }
  });
const fileSchema = z
  .object({ version: z.literal(1), workspaces: z.array(workspaceSchema).max(1000) })
  .strict()
  .superRefine((file, ctx) => {
    const ids = new Set<string>();
    for (const workspace of file.workspaces) {
      if (ids.has(workspace.workspaceId)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['workspaces'], message: 'duplicate workspace id' });
      }
      ids.add(workspace.workspaceId);
    }
  });

export class NativeBrowserStateStore {
  private tail: Promise<void> = Promise.resolve();

  constructor(private readonly filePath: string) {}

  load(): Promise<ReadonlyArray<PersistedNativeBrowserWorkspace>> {
    return this.serialized(async () => {
      let raw: string;
      try {
        raw = await readFile(this.filePath, 'utf8');
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
        throw error;
      }

      try {
        const parsed = fileSchema.parse(JSON.parse(raw));
        return parsed.workspaces;
      } catch {
        await this.quarantine();
        return [];
      }
    });
  }

  save(workspaces: ReadonlyArray<PersistedNativeBrowserWorkspace>): Promise<void> {
    return this.serialized(async () => {
      const value = fileSchema.parse({ version: 1, workspaces });
      const dir = path.dirname(this.filePath);
      await mkdir(dir, { recursive: true, mode: 0o700 });
      const temp = `${this.filePath}.tmp-${process.pid}-${randomUUID()}`;
      await writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
      await rename(temp, this.filePath);
    });
  }

  private serialized<T>(operation: () => Promise<T>): Promise<T> {
    const current = this.tail.then(operation, operation);
    this.tail = current.then(
      () => undefined,
      () => undefined,
    );
    return current;
  }

  private async quarantine(): Promise<void> {
    const quarantined = `${this.filePath}.corrupt-${Date.now()}-${randomUUID()}`;
    try {
      await rename(this.filePath, quarantined);
    } catch {
      // A failed quarantine must never be followed by a write from load(). The
      // malformed source remains in place for manual recovery and load returns
      // an empty in-memory state without clobbering it.
    }
  }
}
