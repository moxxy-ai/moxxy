import { describe, expect, it } from 'vitest';
import { buildWebSearchTool, parseDuckDuckGoHtml } from './web-search.js';

describe('parseDuckDuckGoHtml', () => {
  it('extracts, unwraps, and deduplicates result links with snippets', () => {
    const html = `
      <div class="result">
        <a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fnews&amp;rut=x">
          Example &amp; News
        </a>
        <a class="result__snippet">A <b>fresh</b> result.</a>
      </div>
      <div class="result">
        <a class="result__a" href="https://example.com/news">Duplicate</a>
      </div>
      <div class="result">
        <a class='result__a' href='https://docs.example.org/page'>Docs</a>
        <div class='result__snippet'>Useful docs.</div>
      </div>`;

    expect(parseDuckDuckGoHtml(html)).toEqual([
      { title: 'Example & News', url: 'https://example.com/news', snippet: 'A fresh result.' },
      { title: 'Docs', url: 'https://docs.example.org/page', snippet: 'Useful docs.' },
    ]);
  });
});

describe('web_search tool', () => {
  it('declares provider-hosted web search while retaining its adapter handler as fallback', async () => {
    const tool = buildWebSearchTool({
      adapter: {
        name: 'fixture',
        search: async () => [{ title: 'Result', url: 'https://example.com/' }],
      },
    });
    expect(tool.hosted).toEqual({ type: 'web_search' });
    expect(tool.name).toBe('web_search');
  });
});
