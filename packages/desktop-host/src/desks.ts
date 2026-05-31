/**
 * Desks — isolated workspaces. A desk is a name + bound directory; the
 * supervisor spawns its moxxy runner with that directory as cwd, so
 * moxxy's own config loader picks up the project's `moxxy.config.yaml`
 * and the session/inbox files land scoped to it.
 *
 * Persisted as a small JSON document under
 * `~/.moxxy/desktop/desks.json` so the user's workspaces survive a
 * relaunch. Atomic writes (tmp + rename) so a crash mid-write can't
 * truncate the file.
 */

import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createMutex, writeFileAtomic, type Mutex } from '@moxxy/sdk';

export interface Desk {
  id: string;
  name: string;
  cwd: string;
  color: string;
  createdAt: number;
}

interface DeskDoc {
  version: 1;
  activeId: string | null;
  desks: Desk[];
}

const DESK_FILE = path.join(homedir(), '.moxxy', 'desktop', 'desks.json');
const DEFAULT_COLORS = [
  '#3b82f6', // blue   — Growth Team accent
  '#ef4444', // red    — Product Launch accent
  '#10b981', // green  — Sales Ops accent
  '#8b5cf6', // purple — Research Hub accent
  '#f59e0b', // amber  — Personal accent
  '#06b6d4', // cyan
];

export class DeskStore {
  private readonly path: string;
  /** Serializes every load→modify→save cycle. Without it two concurrent
   *  mutations (create/remove/setActive/rename) both read the same doc and the
   *  second save clobbers the first — losing a desk or stranding activeId on a
   *  deleted desk. The lock makes each mutation see the previous one's result. */
  private readonly mutex: Mutex = createMutex();

  constructor(filePath: string = DESK_FILE) {
    this.path = filePath;
  }

  async load(): Promise<DeskDoc> {
    try {
      const raw = await readFile(this.path, 'utf8');
      const parsed = JSON.parse(raw) as DeskDoc;
      // Light-touch validation: bad shape → start fresh rather than
      // throw and stall onboarding.
      if (!Array.isArray(parsed.desks)) return emptyDoc();
      return {
        version: 1,
        activeId: parsed.activeId ?? null,
        desks: parsed.desks.filter(isValidDesk),
      };
    } catch {
      return emptyDoc();
    }
  }

  async save(doc: DeskDoc): Promise<void> {
    // Crash-atomic write (unique temp + rename, dir created as needed) via the
    // framework's shared helper — no truncated file if a write is interrupted.
    await writeFileAtomic(this.path, JSON.stringify(doc, null, 2));
  }

  async list(): Promise<Desk[]> {
    return (await this.load()).desks;
  }

  async getActive(): Promise<Desk | null> {
    const doc = await this.load();
    return doc.desks.find((d) => d.id === doc.activeId) ?? null;
  }

  async create(input: { name: string; cwd: string; color?: string }): Promise<Desk> {
    return this.mutex.run(async () => {
      const doc = await this.load();
      const desk: Desk = {
        id: randomUUID(),
        name: input.name.trim() || 'Unnamed desk',
        cwd: input.cwd,
        color:
          input.color ??
          DEFAULT_COLORS[doc.desks.length % DEFAULT_COLORS.length]!,
        createdAt: Date.now(),
      };
      doc.desks.push(desk);
      // First desk auto-becomes active.
      if (!doc.activeId) doc.activeId = desk.id;
      await this.save(doc);
      return desk;
    });
  }

  async remove(id: string): Promise<void> {
    return this.mutex.run(async () => {
      const doc = await this.load();
      doc.desks = doc.desks.filter((d) => d.id !== id);
      if (doc.activeId === id) doc.activeId = doc.desks[0]?.id ?? null;
      await this.save(doc);
    });
  }

  async setActive(id: string): Promise<void> {
    return this.mutex.run(async () => {
      const doc = await this.load();
      if (!doc.desks.some((d) => d.id === id)) {
        throw new Error(`unknown desk: ${id}`);
      }
      doc.activeId = id;
      await this.save(doc);
    });
  }

  async rename(id: string, name: string): Promise<Desk> {
    const trimmed = name.trim();
    if (!trimmed) throw new Error('name must not be empty');
    return this.mutex.run(async () => {
      const doc = await this.load();
      const desk = doc.desks.find((d) => d.id === id);
      if (!desk) throw new Error(`unknown desk: ${id}`);
      desk.name = trimmed;
      await this.save(doc);
      return desk;
    });
  }
}

function emptyDoc(): DeskDoc {
  return { version: 1, activeId: null, desks: [] };
}

function isValidDesk(value: unknown): value is Desk {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.id === 'string' &&
    typeof v.name === 'string' &&
    typeof v.cwd === 'string' &&
    typeof v.color === 'string' &&
    typeof v.createdAt === 'number'
  );
}
