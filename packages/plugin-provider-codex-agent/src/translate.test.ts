import { describe, expect, it } from 'vitest';
import { TurnTranslator } from './translate.js';

describe("Codex's web searches", () => {
  it('are shown once finished, with the query Codex only knows by then', () => {
    const translator = new TurnTranslator();
    const started = { type: 'webSearch', id: 'ws1', query: '', action: null, results: null };
    expect(translator.translate('item/started', { item: started })).toEqual([]);

    const completed = { ...started, action: { type: 'search', query: 'frankfurter api v2' } };
    expect(translator.translate('item/completed', { item: completed })).toEqual([
      { type: 'tool_call', callId: 'ws1', name: 'web_search', input: { query: 'frankfurter api v2' } },
      { type: 'tool_result', callId: 'ws1', ok: true, output: '' },
    ]);
  });

  it('show the page Codex opened', () => {
    const translator = new TurnTranslator();
    const item = { type: 'webSearch', id: 'ws2', query: '', action: { type: 'open_page', url: 'https://frankfurter.dev/' }, results: null };
    expect(translator.translate('item/completed', { item })[0]).toEqual({
      type: 'tool_call',
      callId: 'ws2',
      name: 'web_search',
      input: { url: 'https://frankfurter.dev/' },
    });
  });
});

describe("Codex's file changes", () => {
  const change = (path: string, kind: Record<string, unknown>, diff: string) => ({ path, kind, diff });
  const completed = (id: string, changes: unknown[]) => ({ type: 'fileChange', id, status: 'completed', changes });

  it('show a change to one file as a diff, from the unified diff Codex sends', () => {
    const translator = new TurnTranslator('/repo');
    const diff = '@@ -1,2 +1,2 @@\n const host = "x";\n-const port = 5432;\n+const port = 5433;\n';
    const [, result] = translator.translate('item/completed', { item: completed('fc1', [change('/repo/src/db.ts', { type: 'update', move_path: null }, diff)]) });

    expect(result).toMatchObject({
      type: 'tool_result',
      callId: 'fc1',
      ok: true,
      output: { forModel: diff, display: { kind: 'file-diff', path: 'src/db.ts', mode: 'update', added: 1, removed: 1 } },
    });
  });

  it('show a new file as all added, from the content Codex sends for it', () => {
    const translator = new TurnTranslator('/repo');
    const [, result] = translator.translate('item/completed', { item: completed('fc2', [change('/repo/notes.md', { type: 'add' }, '# Notes\nport 5433\n')]) });

    expect(result).toMatchObject({ output: { display: { kind: 'file-diff', path: 'notes.md', mode: 'create', added: 2, removed: 0 } } });
  });

  it('keep a change to several files, or a deleted file, as the text Codex sends', () => {
    const translator = new TurnTranslator('/repo');
    const two = completed('fc3', [change('/repo/a.ts', { type: 'add' }, 'a\n'), change('/repo/b.ts', { type: 'add' }, 'b\n')]);
    const removed = completed('fc4', [change('/repo/old.ts', { type: 'delete' }, 'gone\n')]);

    expect(translator.translate('item/completed', { item: two })[1]).toMatchObject({ ok: true, output: 'a\n\nb\n' });
    expect(translator.translate('item/completed', { item: removed })[1]).toMatchObject({ ok: true, output: 'gone\n' });
  });
});

describe("Codex's images", () => {
  it('keep the screenshot an MCP tool returned, once, with its text', () => {
    const translator = new TurnTranslator('/repo');
    const shot = { type: 'image', data: '/9j/AAA', mimeType: 'image/jpeg', _meta: { 'codex/imageDetail': 'original' } };
    const item = {
      type: 'mcpToolCall',
      id: 'm1',
      server: 'cua_repl',
      tool: 'js',
      status: 'completed',
      arguments: { code: 'await nodeRepl.emitImage(await app.getScreenshot());', title: 'Oglądam testy w przeglądarce' },
      result: { content: [{ type: 'text', text: 'Arc, tests.html' }, shot, shot], structuredContent: null, _meta: {} },
      error: null,
    };

    expect(translator.translate('item/completed', { item })[1]).toEqual({
      type: 'tool_result',
      callId: 'm1',
      ok: true,
      output: { forModel: 'Arc, tests.html', mediaType: 'image/jpeg', base64: '/9j/AAA' },
    });
  });

  it('keep the result of an MCP tool without an image as Codex sent it', () => {
    const translator = new TurnTranslator('/repo');
    const result = { content: [{ type: 'text', text: 'ok' }], structuredContent: null };
    const item = { type: 'mcpToolCall', id: 'm2', server: 'docs', tool: 'search', status: 'completed', arguments: {}, result, error: null };

    expect(translator.translate('item/completed', { item })[1]).toMatchObject({ ok: true, output: result });
  });

  it('show the image file Codex viewed, read from disk', () => {
    const read: string[] = [];
    const translator = new TurnTranslator('/repo', (path) => {
      read.push(path);
      return { mediaType: 'image/png', base64: 'iVBOR' };
    });

    expect(translator.translate('item/completed', { item: { type: 'imageView', id: 'v1', path: '/repo/shot.png' } })).toEqual([
      { type: 'tool_call', callId: 'v1', name: 'view_image', input: { path: '/repo/shot.png' } },
      { type: 'tool_result', callId: 'v1', ok: true, output: { forModel: '/repo/shot.png', mediaType: 'image/png', base64: 'iVBOR' } },
    ]);
    expect(read).toEqual(['/repo/shot.png']);
  });
});
