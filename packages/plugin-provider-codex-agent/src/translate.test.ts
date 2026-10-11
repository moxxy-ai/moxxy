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
