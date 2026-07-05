import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { ProviderRequest } from '@moxxy/sdk';
import {
  UserModelStore,
  userModelTool,
  parseUserModel,
  serializeUserModel,
  renderInjectionBody,
  MAX_INJECTED_CHARS,
  USER_MODEL_OPEN,
  type UserModel,
} from './user-model.js';

let tmp: string;
const newStore = () => new UserModelStore(tmp);
const modelPath = () => path.join(tmp, 'user-model.md');

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'mox-um-'));
});
afterEach(async () => {
  vi.restoreAllMocks();
  await fs.rm(tmp, { recursive: true, force: true });
});

const req = (system?: string): ProviderRequest => ({
  model: 'stub',
  messages: [],
  ...(system !== undefined ? { system } : {}),
});

// ── parse / serialize round-trip ─────────────────────────────────────────────

describe('parseUserModel / serializeUserModel', () => {
  it('round-trips fixed sections with content', () => {
    const text = '## Identity\n\nAlex, a backend dev.\n\n## Preferences\n\nTerse replies.\n';
    const model = parseUserModel(text);
    expect(model.sections.map((s) => s.title)).toEqual(['Identity', 'Preferences']);
    expect(model.sections[0]!.content).toBe('Alex, a backend dev.');
    // serialize → parse is stable
    const reparsed = parseUserModel(serializeUserModel(model));
    expect(reparsed.sections).toEqual(model.sections);
  });

  it('preserves an unknown (hand-added) section verbatim across a round-trip', () => {
    const text =
      '<!-- comment -->\n\n## Identity\n\nA.\n\n## Notes\n\nhand-written aside\nsecond line\n';
    const model = parseUserModel(text);
    expect(model.preamble).toBe('<!-- comment -->');
    const notes = model.sections.find((s) => s.title === 'Notes');
    expect(notes?.content).toBe('hand-written aside\nsecond line');
    // Notes survives serialize → parse.
    const reparsed = parseUserModel(serializeUserModel(model));
    expect(reparsed.sections.find((s) => s.title === 'Notes')?.content).toBe(
      'hand-written aside\nsecond line',
    );
    expect(reparsed.preamble).toBe('<!-- comment -->');
  });
});

// ── renderInjectionBody (size cap) ───────────────────────────────────────────

describe('renderInjectionBody', () => {
  it('omits empty sections and returns "" when nothing has content', () => {
    const empty: UserModel = {
      preamble: '',
      sections: [
        { title: 'Identity', content: '' },
        { title: 'Preferences', content: '   ' },
      ],
    };
    expect(renderInjectionBody(empty)).toBe('');
  });

  it('renders only non-empty sections', () => {
    const model: UserModel = {
      preamble: '',
      sections: [
        { title: 'Identity', content: 'A.' },
        { title: 'Preferences', content: '' },
        { title: 'Workflows', content: 'W.' },
      ],
    };
    const body = renderInjectionBody(model);
    expect(body).toContain('## Identity\nA.');
    expect(body).toContain('## Workflows\nW.');
    expect(body).not.toContain('## Preferences');
  });

  it('drops whole sections oldest-last and appends a (truncated) marker past the cap', () => {
    const big = 'x'.repeat(1500);
    const model: UserModel = {
      preamble: '',
      sections: [
        { title: 'Identity', content: big },
        { title: 'Preferences', content: big },
        { title: 'Workflows', content: big }, // 3×~1500 > 4000 → this one drops
      ],
    };
    const body = renderInjectionBody(model);
    expect(body).toContain('## Identity');
    expect(body).toContain('## Preferences');
    expect(body).not.toContain('## Workflows');
    expect(body).toContain('(truncated)');
    // The kept content stays within the cap (marker excluded).
    expect(body.replace('\n\n(truncated)', '').length).toBeLessThanOrEqual(MAX_INJECTED_CHARS);
  });
});

// ── mtime-cached load ────────────────────────────────────────────────────────

describe('UserModelStore.load (mtime cache)', () => {
  it('returns null when the file is absent', async () => {
    expect(await newStore().load()).toBeNull();
  });

  it('reads the file once, then serves an unchanged file from cache (no re-read)', async () => {
    const store = newStore();
    await store.update('identity', 'first', 'replace');
    const spy = vi.spyOn(fs, 'readFile');
    await store.load();
    await store.load();
    await store.load();
    // Three loads of an unchanged file → a single readFile (mtime unchanged).
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('invalidates the cache when the file changes (via update)', async () => {
    const store = newStore();
    await store.update('identity', 'first', 'replace');
    const before = await store.load();
    expect(before?.sections.find((s) => s.title === 'Identity')?.content).toBe('first');
    await new Promise((r) => setTimeout(r, 10)); // ensure a distinct mtime
    await store.update('identity', 'second', 'replace');
    const after = await store.load();
    expect(after?.sections.find((s) => s.title === 'Identity')?.content).toBe('second');
  });

  it('picks up an out-of-band write with a newer mtime', async () => {
    const store = newStore();
    await store.update('identity', 'first', 'replace');
    await store.load(); // prime the cache
    await new Promise((r) => setTimeout(r, 10));
    await fs.writeFile(modelPath(), '## Identity\n\nrewritten\n');
    expect((await store.load())?.sections.find((s) => s.title === 'Identity')?.content).toBe(
      'rewritten',
    );
  });
});

// ── update (template creation, replace/append) ───────────────────────────────

describe('UserModelStore.update', () => {
  it('creates the file with the commented template on first write', async () => {
    const store = newStore();
    await store.update('identity', 'Alex', 'replace');
    const raw = await fs.readFile(modelPath(), 'utf8');
    expect(raw).toContain('<!-- moxxy user model');
    // All four fixed sections exist (template), with Identity filled.
    for (const h of ['## Identity', '## Preferences', '## Workflows', '## Context']) {
      expect(raw).toContain(h);
    }
    expect(raw).toContain('Alex');
  });

  it('replace overwrites the section content', async () => {
    const store = newStore();
    await store.update('preferences', 'terse', 'replace');
    await store.update('preferences', 'verbose', 'replace');
    const m = await store.load();
    expect(m?.sections.find((s) => s.title === 'Preferences')?.content).toBe('verbose');
  });

  it('append adds to existing content on its own line', async () => {
    const store = newStore();
    await store.update('workflows', 'uses pnpm', 'replace');
    await store.update('workflows', 'rebases often', 'append');
    const content = (await store.load())?.sections.find((s) => s.title === 'Workflows')?.content;
    expect(content).toBe('uses pnpm\nrebases often');
  });

  it('append on an empty section behaves like replace', async () => {
    const store = newStore();
    await store.update('context', 'sole line', 'append');
    expect((await store.load())?.sections.find((s) => s.title === 'Context')?.content).toBe(
      'sole line',
    );
  });

  it('preserves an unknown section when a tool write touches a fixed one', async () => {
    const store = newStore();
    await store.update('identity', 'A', 'replace');
    // Hand-add a section out of band, then update via the store.
    const raw = await fs.readFile(modelPath(), 'utf8');
    await fs.writeFile(modelPath(), raw + '\n## Notes\n\nkeep me\n');
    await new Promise((r) => setTimeout(r, 10));
    await store.update('preferences', 'terse', 'replace');
    const raw2 = await fs.readFile(modelPath(), 'utf8');
    expect(raw2).toContain('## Notes');
    expect(raw2).toContain('keep me');
  });
});

// ── injection hook ───────────────────────────────────────────────────────────

describe('UserModelStore.injectInto', () => {
  it('is a no-op when the file is absent', async () => {
    expect(await newStore().injectInto(req('BASE'))).toBeUndefined();
  });

  it('is a no-op when the file has only the (empty) template', async () => {
    const store = newStore();
    // A template with no filled sections should not inject an empty block.
    await fs.writeFile(modelPath(), '<!-- c -->\n\n## Identity\n\n## Preferences\n');
    expect(await store.injectInto(req('BASE'))).toBeUndefined();
  });

  it('prepends a delimited <user-model> block plus the durable-context note', async () => {
    const store = newStore();
    await store.update('identity', 'Alex, backend dev', 'replace');
    const out = (await store.injectInto(req('BASE SYSTEM'))) as ProviderRequest;
    expect(out.system!.startsWith(USER_MODEL_OPEN)).toBe(true);
    expect(out.system).toContain('## Identity\nAlex, backend dev');
    expect(out.system).toContain('</user-model>');
    expect(out.system).toContain('memory_update_user_model');
    // Original system prompt is retained, AFTER the block.
    expect(out.system).toContain('BASE SYSTEM');
    expect(out.system!.indexOf(USER_MODEL_OPEN)).toBeLessThan(out.system!.indexOf('BASE SYSTEM'));
  });

  it('injects even when req.system is undefined', async () => {
    const store = newStore();
    await store.update('identity', 'A', 'replace');
    const out = (await store.injectInto(req())) as ProviderRequest;
    expect(out.system).toContain('<user-model>');
  });

  it('is idempotent: skips when a <user-model> block is already present', async () => {
    const store = newStore();
    await store.update('identity', 'A', 'replace');
    const first = (await store.injectInto(req('BASE'))) as ProviderRequest;
    // Re-entering with the already-injected system must NOT double-inject.
    const second = await store.injectInto(first);
    expect(second).toBeUndefined();
    // Only one opening delimiter present.
    expect(first.system!.match(/<user-model>/g)).toHaveLength(1);
  });

  it('returns the request unchanged when parsing/reading throws', async () => {
    const store = newStore();
    await store.update('identity', 'A', 'replace');
    vi.spyOn(fs, 'readFile').mockRejectedValueOnce(new Error('disk on fire'));
    expect(await store.injectInto(req('BASE'))).toBeUndefined();
  });
});

// ── the tool ─────────────────────────────────────────────────────────────────

describe('userModelTool', () => {
  it('is prompt-permissioned and isolated to the memory dir', () => {
    const tool = userModelTool(newStore());
    expect(tool.name).toBe('memory_update_user_model');
    expect(tool.permission).toEqual({ action: 'prompt' });
    expect(tool.isolation?.capabilities?.fs?.write).toEqual(['~/.moxxy/memory/**']);
    expect(tool.isolation?.capabilities?.net).toEqual({ mode: 'none' });
  });

  it('rejects an out-of-enum section and over-long content', () => {
    const schema = userModelTool(newStore()).inputSchema;
    expect(schema.safeParse({ section: 'identity', content: 'ok' }).success).toBe(true);
    expect(schema.safeParse({ section: 'unknown', content: 'ok' }).success).toBe(false);
    expect(schema.safeParse({ section: 'identity', content: 'x'.repeat(2001) }).success).toBe(false);
  });

  it("defaults mode to 'replace'", () => {
    const schema = userModelTool(newStore()).inputSchema;
    const parsed = schema.parse({ section: 'identity', content: 'A' });
    expect(parsed.mode).toBe('replace');
  });

  it('writes through to the file and creates the template', async () => {
    const store = newStore();
    const tool = userModelTool(store);
    const out = (await tool.handler(
      { section: 'identity', content: 'Alex', mode: 'replace' },
      {} as never,
    )) as { section: string; mode: string; path: string };
    expect(out.section).toBe('identity');
    expect((await store.load())?.sections.find((s) => s.title === 'Identity')?.content).toBe('Alex');
    const raw = await fs.readFile(modelPath(), 'utf8');
    expect(raw).toContain('<!-- moxxy user model');
  });
});
