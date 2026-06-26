import { describe, expect, it } from 'vitest';
import { markdownToTelegramHtml } from './format.js';

describe('markdownToTelegramHtml', () => {
  it('escapes raw HTML special chars in plain text', () => {
    expect(markdownToTelegramHtml('< & > "')).toBe('&lt; &amp; &gt; "');
  });

  it('renders headings as bold lines', () => {
    expect(markdownToTelegramHtml('# Title\nbody')).toContain('<b>Title</b>');
  });

  it('converts bold and italic correctly', () => {
    const out = markdownToTelegramHtml('Hello **world** and *italic*.');
    expect(out).toContain('<b>world</b>');
    expect(out).toContain('<i>italic</i>');
  });

  it('renders inline code in <code>', () => {
    const out = markdownToTelegramHtml('use `npm install` to set up.');
    expect(out).toContain('<code>npm install</code>');
  });

  it('renders fenced code blocks with language class', () => {
    const out = markdownToTelegramHtml('```ts\nconst x = 1;\n```');
    expect(out).toContain('<pre><code class="language-ts">');
    expect(out).toContain('const x = 1;');
    expect(out).toContain('</code></pre>');
  });

  it('does NOT process markdown inside code blocks', () => {
    const out = markdownToTelegramHtml('```\n**not bold**\n```');
    expect(out).not.toContain('<b>not bold</b>');
    expect(out).toContain('**not bold**');
  });

  it('converts links to <a href="...">', () => {
    const out = markdownToTelegramHtml('See [docs](https://example.com).');
    expect(out).toContain('<a href="https://example.com">docs</a>');
  });

  it('allows http, mailto, and tel scheme links', () => {
    expect(markdownToTelegramHtml('[a](http://x.com)')).toContain('<a href="http://x.com">');
    expect(markdownToTelegramHtml('[m](mailto:a@b.com)')).toContain('<a href="mailto:a@b.com">');
    expect(markdownToTelegramHtml('[t](tel:+15551234)')).toContain('<a href="tel:+15551234">');
  });

  it('allows scheme-less / relative / anchor links', () => {
    expect(markdownToTelegramHtml('[r](/path/to/thing)')).toContain('<a href="/path/to/thing">');
    expect(markdownToTelegramHtml('[a](#section)')).toContain('<a href="#section">');
    expect(markdownToTelegramHtml('[h](example.com/page)')).toContain('<a href="example.com/page">');
  });

  it('does NOT emit an anchor for dangerous URL schemes', () => {
    // javascript:, data:, file:, and tg:// deep links must never become a
    // clickable <a href> — they fall back to the (escaped) link text.
    for (const url of [
      'javascript:doThing',
      'JavaScript:doThing',
      'data:text/html,<script>x</script>',
      'file:///etc/passwd',
      'tg://resolve?domain=evil',
    ]) {
      const out = markdownToTelegramHtml(`[click](${url})`);
      expect(out).not.toContain('<a href');
      expect(out).toContain('[click]');
    }
  });

  it('rejects an uppercase / mixed-case dangerous scheme', () => {
    expect(markdownToTelegramHtml('[x](TG://resolve?domain=evil)')).not.toContain('<a href');
    expect(markdownToTelegramHtml('[x](Data:text/plain,hi)')).not.toContain('<a href');
  });

  it('rejects a control char used to hide a dangerous scheme', () => {
    // A leading SOH (\x01) must not let "javascript:" slip past the scheme check.
    const out = markdownToTelegramHtml('[x](' + String.fromCharCode(1) + 'javascript:doThing)');
    expect(out).not.toContain('<a href');
  });

  it('converts bullet markers to • glyph', () => {
    const out = markdownToTelegramHtml('- one\n- two');
    expect(out).toContain('• one');
    expect(out).toContain('• two');
  });

  it("doesn't italicize mid-word underscores", () => {
    const out = markdownToTelegramHtml('var_name_here');
    expect(out).not.toContain('<i>');
    expect(out).toContain('var_name_here');
  });

  it('renders ~~strikethrough~~ as <s>', () => {
    const out = markdownToTelegramHtml('this is ~~gone~~ now');
    expect(out).toContain('<s>gone</s>');
  });

  it('leaves a single ~ tilde literal', () => {
    const out = markdownToTelegramHtml('about ~5 minutes');
    expect(out).not.toContain('<s>');
    expect(out).toContain('~5 minutes');
  });

  it('renders ||spoiler|| as <tg-spoiler>', () => {
    const out = markdownToTelegramHtml('the answer is ||42||');
    expect(out).toContain('<tg-spoiler>42</tg-spoiler>');
  });

  it("doesn't turn a single | into a spoiler", () => {
    const out = markdownToTelegramHtml('a | b | c');
    expect(out).not.toContain('tg-spoiler');
  });

  it('renders a [!note] callout as a titled, always-open blockquote', () => {
    const out = markdownToTelegramHtml('> [!note] Heads up\n> read this carefully');
    expect(out).toContain('<blockquote><b>ℹ️ Heads up</b>');
    expect(out).toContain('read this carefully');
    expect(out).not.toContain('expandable');
  });

  it('uses the type name as the title when none is given', () => {
    const out = markdownToTelegramHtml('> [!warning]\n> careful');
    expect(out).toContain('<b>⚠️ Warning</b>');
  });

  it('collapses a [!details]- callout into an expandable box', () => {
    const out = markdownToTelegramHtml('> [!details]- Internals\n> gory detail one\n> gory detail two');
    expect(out).toContain('<blockquote expandable><b>📋 Internals</b>');
    expect(out).toContain('gory detail one');
  });

  it('collapses fold-by-default callout types (details) even without a marker', () => {
    expect(markdownToTelegramHtml('> [!details] X\n> y')).toContain('<blockquote expandable>');
  });

  it('honours a trailing + to force a fold-by-default callout open', () => {
    const out = markdownToTelegramHtml('> [!faq]+ Q?\n> A.');
    expect(out).toContain('<blockquote><b>❓ Q?</b>');
    expect(out).not.toContain('expandable');
  });

  it('auto-collapses a long plain quote into an expandable box', () => {
    const out = markdownToTelegramHtml('> one\n> two\n> three\n> four');
    expect(out).toContain('<blockquote expandable>');
    expect(out).toContain('four');
  });

  it('keeps a short plain quote as a normal blockquote', () => {
    const out = markdownToTelegramHtml('> just one line');
    expect(out).toContain('<blockquote>just one line</blockquote>');
    expect(out).not.toContain('expandable');
  });

  it('leaves an unrecognised [!type] as literal quote text', () => {
    const out = markdownToTelegramHtml('> [!bogus] hello');
    expect(out).toContain('<blockquote>[!bogus] hello</blockquote>');
    expect(out).not.toContain('expandable');
  });
});
