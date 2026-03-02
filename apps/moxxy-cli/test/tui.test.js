import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { shortId, formatNumber, makeBar, COLORS, formatTs } from '../src/tui/helpers.js';
import { renderMarkdown } from '../src/tui/markdown-renderer.js';
import { matchCommands, SLASH_COMMANDS } from '../src/tui/slash-commands.js';

describe('tui helpers', () => {
  it('shortId truncates to 12 chars', () => {
    assert.equal(shortId('019cac13-f39a-7e70-a6aa-43827f539a10'), '019cac13-f39');
  });

  it('shortId handles null', () => {
    assert.equal(shortId(null), '?');
  });

  it('shortId handles undefined', () => {
    assert.equal(shortId(undefined), '?');
  });

  it('formatNumber formats with locale', () => {
    const result = formatNumber(12450);
    assert.ok(result.length > 0);
  });

  it('formatNumber handles zero', () => {
    assert.equal(formatNumber(0), '0');
  });

  it('formatNumber handles undefined', () => {
    assert.equal(formatNumber(undefined), '0');
  });

  it('makeBar returns filled blocks', () => {
    const bar = makeBar(5, 10);
    assert.equal(bar.length, 5);
    assert.ok(bar.includes('\u2588'));
  });

  it('makeBar returns empty for zero', () => {
    assert.equal(makeBar(0, 10).length, 0);
  });

  it('makeBar handles zero maxCount', () => {
    assert.equal(makeBar(5, 0).length, 0);
  });

  it('COLORS has all status entries', () => {
    assert.ok(COLORS.status.idle);
    assert.ok(COLORS.status.running);
    assert.ok(COLORS.status.stopped);
    assert.ok(COLORS.status.error);
  });

  it('COLORS has accent and user colors', () => {
    assert.ok(COLORS.accent);
    assert.ok(COLORS.user);
    assert.ok(COLORS.assistant);
    assert.ok(COLORS.error);
  });

  it('formatTs handles epoch millis', () => {
    const result = formatTs(1700000000000);
    assert.ok(result.length > 0);
  });

  it('formatTs handles null', () => {
    assert.equal(formatTs(null), '');
  });
});

describe('markdown renderer', () => {
  it('renders null content gracefully', () => {
    const result = renderMarkdown(null);
    assert.ok(Array.isArray(result));
    assert.ok(result.length > 0);
  });

  it('renders empty string gracefully', () => {
    const result = renderMarkdown('');
    assert.ok(Array.isArray(result));
  });

  it('renders a paragraph', () => {
    const result = renderMarkdown('Hello world');
    assert.ok(Array.isArray(result));
    assert.ok(result.length >= 1);
  });

  it('renders a heading', () => {
    const result = renderMarkdown('# Title');
    assert.ok(Array.isArray(result));
  });

  it('renders code blocks', () => {
    const result = renderMarkdown('```js\nconsole.log("hi")\n```');
    assert.ok(Array.isArray(result));
  });

  it('renders inline code', () => {
    const result = renderMarkdown('Use `npm install`');
    assert.ok(Array.isArray(result));
  });

  it('renders bold text', () => {
    const result = renderMarkdown('This is **bold**');
    assert.ok(Array.isArray(result));
  });

  it('renders italic text', () => {
    const result = renderMarkdown('This is *italic*');
    assert.ok(Array.isArray(result));
  });

  it('renders lists', () => {
    const result = renderMarkdown('- item 1\n- item 2\n- item 3');
    assert.ok(Array.isArray(result));
  });
});

describe('tab slash commands', () => {
  it('matchCommands finds /tab commands', () => {
    const matches = matchCommands('/tab');
    assert.ok(matches.length >= 3);
  });

  it('matchCommands finds /close alias', () => {
    const matches = matchCommands('/close');
    assert.ok(matches.length >= 1);
  });

  it('slash commands include tab commands', () => {
    const tabCmds = SLASH_COMMANDS.filter(c => c.name.startsWith('/tab'));
    assert.ok(tabCmds.length >= 3);
  });
});

describe('vault slash commands', () => {
  it('matchCommands returns vault subcommands for /vault', () => {
    const matches = matchCommands('/vault');
    const names = matches.map(m => m.name);
    assert.ok(names.includes('/vault list'));
    assert.ok(names.includes('/vault set'));
    assert.ok(names.includes('/vault remove'));
  });

  it('matchCommands matches /vault delete alias', () => {
    const matches = matchCommands('/vault delete');
    assert.ok(matches.length >= 1);
    assert.ok(matches.some(m => m.name === '/vault remove'));
  });

  it('SLASH_COMMANDS includes vault entries', () => {
    const vaultCmds = SLASH_COMMANDS.filter(c => c.name.startsWith('/vault'));
    assert.ok(vaultCmds.length >= 3);
  });
});

describe('model slash commands', () => {
  it('matchCommands matches /model l to /model list', () => {
    const matches = matchCommands('/model l');
    assert.ok(matches.some(m => m.name === '/model list'));
  });

  it('matchCommands returns model subcommands for /model', () => {
    const matches = matchCommands('/model');
    const names = matches.map(m => m.name);
    assert.ok(names.includes('/model'));
    assert.ok(names.includes('/model list'));
    assert.ok(names.includes('/model switch'));
  });

  it('SLASH_COMMANDS includes model entries', () => {
    const modelCmds = SLASH_COMMANDS.filter(c => c.name.startsWith('/model'));
    assert.ok(modelCmds.length >= 3);
  });
});
