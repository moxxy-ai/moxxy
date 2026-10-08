import { describe, expect, it } from 'vitest';
import { blockText } from './block-text';

/** What lands on the clipboard when a block of a message is copied. */

function el(html: string): HTMLElement {
  const host = document.createElement('div');
  host.innerHTML = html;
  return host.firstElementChild as HTMLElement;
}

describe('blockText', () => {
  it('copies a quotation as its words', () => {
    expect(blockText(el('<blockquote>\n<p>The third query timed out.</p>\n</blockquote>'))).toBe('The third query timed out.');
  });

  it('copies code as it is written, without the fence’s last newline', () => {
    expect(blockText(el('<pre><code>const a = 1;\n  return a;\n</code></pre>'))).toBe('const a = 1;\n  return a;');
  });

  it('copies a table as rows of tab-separated cells, ready for a sheet', () => {
    const table = el(
      '<div><table><thead><tr><th>Suite</th><th>Tests</th></tr></thead><tbody><tr><td>contrast</td><td>68</td></tr><tr><td>css-vars</td><td> 62 </td></tr></tbody></table></div>',
    );
    expect(blockText(table)).toBe('Suite\tTests\ncontrast\t68\ncss-vars\t62');
  });
});
