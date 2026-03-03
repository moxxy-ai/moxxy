import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { shortId, formatNumber, makeBar, COLORS, formatTs } from '../src/tui/helpers.js';
import { renderMarkdown } from '../src/tui/markdown-renderer.js';
import { matchCommands, SLASH_COMMANDS } from '../src/tui/slash-commands.js';
<<<<<<< Updated upstream
import { StatusBar, computeContextUtilization } from '../src/tui/status-bar.js';
=======
import { StatusBar } from '../src/tui/status-bar.js';
>>>>>>> Stashed changes
import { EventsHandler } from '../src/tui/events-handler.js';

function stripAnsi(s) {
  return String(s || '').replace(/\x1b\[[0-9;]*m/g, '');
}

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

describe('status bar', () => {
<<<<<<< Updated upstream
  it('renders token and context usage as percentage when context window is known', () => {
=======
  it('renders token and context usage on the top line', () => {
>>>>>>> Stashed changes
    const bar = new StatusBar();
    bar.setAgent({
      id: '019cb068-9930-7000-8000-123456789abc',
      status: 'idle',
      provider_id: 'openai',
      model_id: 'gpt-4o-mini',
    });
    bar.setConnected(true);
    bar.setContextWindow(8192);
    bar.setStats({
      eventCount: 6,
<<<<<<< Updated upstream
      tokenEstimate: 1915,
      contextTokens: 1896,
=======
      tokenEstimate: 1234,
      contextTokens: 512,
>>>>>>> Stashed changes
      skills: {},
      primitives: {},
    });

    const lines = bar.render(120);
    const mid = stripAnsi(lines[1]);
    assert.ok(mid.includes('Ev:6'));
    assert.ok(mid.includes('Tok:'));
<<<<<<< Updated upstream
    assert.ok(mid.includes('Ctx:1,896/8,192 (23%)'));
  });

  it('hides context segment when context window is unknown', () => {
    const bar = new StatusBar();
    bar.setAgent({
      id: '019cb068-9930-7000-8000-123456789abc',
      status: 'idle',
      provider_id: 'openai',
      model_id: 'gpt-4o-mini',
    });
    bar.setConnected(true);
    bar.setContextWindow(0);
    bar.setStats({
      eventCount: 1,
      tokenEstimate: 100,
      contextTokens: 1896,
      skills: {},
      primitives: {},
    });

    const lines = bar.render(120);
    const mid = stripAnsi(lines[1]);
    assert.ok(mid.includes('Tok:100'));
    assert.ok(!mid.includes('Ctx:'));
    assert.ok(!mid.includes('%'));
  });

  it('computes utilization thresholds and clamps to 0..100', () => {
    assert.deepEqual(computeContextUtilization(600, 1000), {
      hasWindow: true,
      percent: 60,
      band: 'low',
    });
    assert.deepEqual(computeContextUtilization(610, 1000), {
      hasWindow: true,
      percent: 61,
      band: 'medium',
    });
    assert.deepEqual(computeContextUtilization(800, 1000), {
      hasWindow: true,
      percent: 80,
      band: 'medium',
    });
    assert.deepEqual(computeContextUtilization(810, 1000), {
      hasWindow: true,
      percent: 81,
      band: 'high',
    });
    assert.deepEqual(computeContextUtilization(-100, 1000), {
      hasWindow: true,
      percent: 0,
      band: 'low',
    });
    assert.deepEqual(computeContextUtilization(5000, 1000), {
      hasWindow: true,
      percent: 100,
      band: 'high',
    });
    assert.deepEqual(computeContextUtilization(500, 0), {
      hasWindow: false,
      percent: 0,
      band: 'low',
    });
=======
    assert.ok(mid.includes('Ctx:'));
    assert.ok(mid.includes('/'));
>>>>>>> Stashed changes
  });
});

describe('events handler stats', () => {
  it('accumulates usage tokens and latest context tokens from model.response', () => {
    const h = new EventsHandler({}, 'agent-1');

    h._processEvent({
      event_type: 'model.response',
      payload: {
        usage: {
          prompt_tokens: 120,
          completion_tokens: 30,
          total_tokens: 150,
        },
      },
    });

    h._processEvent({
      event_type: 'model.response',
      payload: {
        usage: {
          input_tokens: 80,
          output_tokens: 20,
          total_tokens: 100,
        },
      },
    });

    assert.equal(h.stats.tokenEstimate, 250);
    assert.equal(h.stats.contextTokens, 80);
  });
<<<<<<< Updated upstream

  it('reads usage nested under payload.response.usage', () => {
    const h = new EventsHandler({}, 'agent-1');

    h._processEvent({
      event_type: 'model.response',
      payload: {
        response: {
          usage: {
            input_tokens: 60,
            output_tokens: 15,
            total_tokens: 75,
          },
        },
      },
    });

    assert.equal(h.stats.tokenEstimate, 75);
    assert.equal(h.stats.contextTokens, 60);
  });

  it('reads usage when tokens are on payload top-level', () => {
    const h = new EventsHandler({}, 'agent-1');

    h._processEvent({
      event_type: 'model.response',
      payload: {
        prompt_tokens: 40,
        completion_tokens: 10,
        total_tokens: 50,
      },
    });

    assert.equal(h.stats.tokenEstimate, 50);
    assert.equal(h.stats.contextTokens, 40);
  });
=======
>>>>>>> Stashed changes
});
