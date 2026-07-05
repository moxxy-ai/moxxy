import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import {
  z,
  defineTool,
  createMutex,
  type Mutex,
  type ProviderRequest,
  type ToolDef,
} from '@moxxy/sdk';
import { moxxyPath, writeFileAtomic } from '@moxxy/sdk/server';

/**
 * The persistent USER MODEL — `~/.moxxy/memory/user-model.md`.
 *
 * A single, first-class Markdown file holding DURABLE facts about who the user
 * is and how they work. Unlike episodic long-term memories (one file each,
 * recalled on demand), the user model is ALWAYS injected into the system prompt
 * as a delimited `<user-model>` block, and is updated ONLY through the
 * deliberate, permission-prompted `memory_update_user_model` tool — never
 * silently written by the loop.
 *
 * The file is a small set of fixed H2 sections (Identity / Preferences /
 * Workflows / Context). Unknown sections a user hand-adds are parsed and
 * preserved verbatim on the next write.
 */

// ── Block delimiters (also the idempotence sentinel) ────────────────────────
export const USER_MODEL_OPEN = '<user-model>';
export const USER_MODEL_CLOSE = '</user-model>';

/**
 * Hard cap on the injected block body. The block rides EVERY provider call, so
 * an unbounded user model would silently inflate every request. When the
 * rendered sections exceed this, whole sections are dropped oldest-last (from
 * the bottom) and a `(truncated)` marker is appended.
 */
export const MAX_INJECTED_CHARS = 4000;

/** The four fixed sections, in canonical order. */
export const FIXED_SECTIONS = ['Identity', 'Preferences', 'Workflows', 'Context'] as const;

/** Lowercase tool-facing section keys → canonical H2 titles. */
export const SECTION_TITLES: Record<UserModelSectionKey, string> = {
  identity: 'Identity',
  preferences: 'Preferences',
  workflows: 'Workflows',
  context: 'Context',
};

export type UserModelSectionKey = 'identity' | 'preferences' | 'workflows' | 'context';
export type UserModelUpdateMode = 'replace' | 'append';

export interface UserModelSection {
  readonly title: string;
  content: string;
}

export interface UserModel {
  /** Text before the first `## ` heading (kept verbatim — holds the template comment). */
  preamble: string;
  sections: UserModelSection[];
}

/** The commented template written when the file is first created. */
const TEMPLATE_PREAMBLE = `<!-- moxxy user model — durable facts about who the user is and how they work.
     This file is ALWAYS injected into the system prompt and is updated ONLY via the
     permission-prompted memory_update_user_model tool. Keep entries terse and stable. -->`;

function templateModel(): UserModel {
  return {
    preamble: TEMPLATE_PREAMBLE,
    sections: FIXED_SECTIONS.map((title) => ({ title, content: '' })),
  };
}

// ── parse / serialize (round-trips unknown sections) ─────────────────────────

const HEADING_RE = /^##\s+(.+?)\s*$/;

/**
 * Parse the user-model Markdown into a preamble + ordered H2 sections. Any
 * section title is preserved (not just the fixed four), so a user's hand-added
 * `## Notes` survives the next tool write.
 */
export function parseUserModel(text: string): UserModel {
  const preambleLines: string[] = [];
  const sections: UserModelSection[] = [];
  let current: { title: string; body: string[] } | null = null;
  let seenHeading = false;

  for (const line of text.split('\n')) {
    const m = HEADING_RE.exec(line);
    if (m) {
      seenHeading = true;
      if (current) sections.push({ title: current.title, content: current.body.join('\n').trim() });
      current = { title: m[1]!.trim(), body: [] };
    } else if (!seenHeading) {
      preambleLines.push(line);
    } else if (current) {
      current.body.push(line);
    }
  }
  if (current) sections.push({ title: current.title, content: current.body.join('\n').trim() });
  return { preamble: preambleLines.join('\n').trim(), sections };
}

/** Serialize back to Markdown, preserving the preamble and every section. */
export function serializeUserModel(model: UserModel): string {
  const parts: string[] = [];
  if (model.preamble.trim()) parts.push(model.preamble.trim());
  for (const s of model.sections) {
    const content = s.content.trim();
    parts.push(content ? `## ${s.title}\n\n${content}` : `## ${s.title}`);
  }
  return parts.join('\n\n') + '\n';
}

/**
 * Render the injected block body from a model, capped at {@link MAX_INJECTED_CHARS}.
 * Empty sections are omitted. When the cap is hit, whole sections are dropped
 * from the bottom (oldest-last) and a `(truncated)` marker is appended. Returns
 * `''` when there is no non-empty content to inject.
 */
export function renderInjectionBody(model: UserModel, max: number = MAX_INJECTED_CHARS): string {
  const chunks: string[] = [];
  let used = 0;
  let truncated = false;
  for (const s of model.sections) {
    const content = s.content.trim();
    if (!content) continue;
    const chunk = `## ${s.title}\n${content}`;
    const cost = (chunks.length > 0 ? 2 : 0) + chunk.length; // 2 for the "\n\n" join
    if (used + cost > max) {
      truncated = true;
      break;
    }
    chunks.push(chunk);
    used += cost;
  }
  if (chunks.length === 0) return '';
  return chunks.join('\n\n') + (truncated ? '\n\n(truncated)' : '');
}

function isEnoent(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: string }).code === 'ENOENT';
}

/** Default on-disk location: `~/.moxxy/memory/user-model.md` (MOXXY_HOME-aware). */
export function defaultUserModelPath(): string {
  return moxxyPath('memory', 'user-model.md');
}

/**
 * The user-model store. One instance per plugin build; the injection hook and
 * the update tool close over the same instance. `load()` is mtime-cached so the
 * always-on injection does zero `readFile`s when the file is unchanged (a single
 * `stat` per provider call); `update()` does an atomic read-modify-write under a
 * mutex.
 */
export class UserModelStore {
  readonly path: string;
  private readonly mutex: Mutex = createMutex();
  private cached: { mtimeMs: number; model: UserModel } | null = null;

  /** @param dir the memory directory (defaults to `~/.moxxy/memory`). */
  constructor(dir?: string) {
    this.path = join(dir ?? moxxyPath('memory'), 'user-model.md');
  }

  /**
   * mtime-cached load. Returns `null` when the file is absent. On an unchanged
   * file this only `stat`s — no `readFile` — so it's cheap to call on every
   * provider request.
   */
  async load(): Promise<UserModel | null> {
    let mtimeMs: number;
    try {
      mtimeMs = (await fs.stat(this.path)).mtimeMs;
    } catch (err) {
      if (isEnoent(err)) {
        this.cached = null;
        return null;
      }
      throw err;
    }
    if (this.cached && this.cached.mtimeMs === mtimeMs) return this.cached.model;
    const model = parseUserModel(await fs.readFile(this.path, 'utf8'));
    this.cached = { mtimeMs, model };
    return model;
  }

  /** Raw file text (or `null` when absent) — used by the CLI viewer. */
  async readRaw(): Promise<string | null> {
    try {
      return await fs.readFile(this.path, 'utf8');
    } catch (err) {
      if (isEnoent(err)) return null;
      throw err;
    }
  }

  /**
   * Set (`replace`) or extend (`append`) one section, atomically. Creates the
   * file with the commented template on first write. Bypasses the mtime cache
   * on read so a concurrent external edit is not clobbered, and invalidates the
   * cache after the write.
   */
  async update(section: UserModelSectionKey, content: string, mode: UserModelUpdateMode): Promise<UserModel> {
    const title = SECTION_TITLES[section];
    return this.mutex.run(async () => {
      const model = (await this.readDisk()) ?? templateModel();
      let sec = model.sections.find((s) => s.title.toLowerCase() === title.toLowerCase());
      if (!sec) {
        sec = { title, content: '' };
        model.sections.push(sec);
      }
      const incoming = content.trim();
      const prior = sec.content.trim();
      sec.content = mode === 'append' && prior ? `${prior}\n${incoming}`.trim() : incoming;
      await writeFileAtomic(this.path, serializeUserModel(model));
      this.cached = null; // next load() re-reads the fresh file
      return model;
    });
  }

  /** Uncached disk read (used inside the update RMW). */
  private async readDisk(): Promise<UserModel | null> {
    const raw = await this.readRaw();
    return raw === null ? null : parseUserModel(raw);
  }

  /**
   * The always-on injection: prepend a delimited `<user-model>` block to
   * `req.system`. Returns the request unchanged (void) when the file is absent
   * or has no non-empty content, when a `<user-model>` block is already present
   * (side-channel calls re-enter this hook — inject exactly once), or on ANY
   * error (injection must never break a provider call).
   */
  async injectInto(req: ProviderRequest): Promise<ProviderRequest | void> {
    try {
      if ((req.system ?? '').includes(USER_MODEL_OPEN)) return; // idempotent
      const model = await this.load();
      if (!model) return;
      const body = renderInjectionBody(model);
      if (!body) return;
      const block =
        `${USER_MODEL_OPEN}\n${body}\n${USER_MODEL_CLOSE}\n` +
        'The block above is durable context about the user, maintained across sessions via the ' +
        '`memory_update_user_model` tool. Treat it as reliable background on who the user is and how they work.';
      return { ...req, system: `${block}\n\n${req.system ?? ''}`.trimEnd() };
    } catch {
      return; // any parse/fs error → leave the request untouched
    }
  }
}

// ── the update tool ──────────────────────────────────────────────────────────

const sectionSchema = z.enum(['identity', 'preferences', 'workflows', 'context']);

/**
 * `memory_update_user_model` — the ONLY writer of the persistent user model.
 * Permission-prompted like `memory_save`, and isolated to the memory dir.
 */
export function userModelTool(store: UserModelStore): ToolDef {
  return defineTool({
    name: 'memory_update_user_model',
    description:
      'Update the persistent USER MODEL (~/.moxxy/memory/user-model.md), which is ALWAYS injected ' +
      'into your system prompt. PREFER this over memory_save for durable facts about WHO THE USER IS ' +
      "and HOW THEY WORK — their identity, standing preferences, personal workflows, and lasting context — " +
      'NOT for episodic facts (use memory_save for a one-off answer or project detail). ' +
      "mode 'replace' overwrites the section; 'append' adds to it. Keep each section terse.",
    inputSchema: z.object({
      section: sectionSchema,
      content: z.string().max(2000),
      mode: z.enum(['replace', 'append']).default('replace'),
    }),
    permission: { action: 'prompt' },
    isolation: {
      capabilities: {
        fs: { read: ['~/.moxxy/memory/**'], write: ['~/.moxxy/memory/**'] },
        net: { mode: 'none' },
        timeMs: 5_000,
      },
    },
    handler: async ({ section, content, mode }) => {
      await store.update(section, content, mode);
      return { section, mode, path: store.path };
    },
  });
}
