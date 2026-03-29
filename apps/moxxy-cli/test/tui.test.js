import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { shortId, formatNumber, makeBar, COLORS, formatTs } from '../src/tui/helpers.js';
import { renderMarkdown } from '../src/tui/markdown-renderer.js';
import { matchCommands, SLASH_COMMANDS } from '../src/tui/slash-commands.js';
import { computeContextUtilization } from '../src/tui/components/header.jsx';
import { EventsHandler } from '../src/tui/events-handler.js';
import {
  buildModelPickerEntries,
  clampPickerScroll,
  movePickerSelection,
} from '../src/tui/model-picker.js';
import { resolveAutocompleteSelection } from '../src/tui/input-utils.js';

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
  it('matchCommands returns only /vault for /vault prefix', () => {
    const matches = matchCommands('/vault');
    const names = matches.map(m => m.name);
    assert.ok(names.includes('/vault'));
    assert.equal(names.filter(name => name.startsWith('/vault')).length, 1);
  });

  it('SLASH_COMMANDS exposes a single vault command', () => {
    const vaultCmds = SLASH_COMMANDS.filter(c => c.name.startsWith('/vault'));
    assert.equal(vaultCmds.length, 1);
    assert.equal(vaultCmds[0].name, '/vault');
  });
});

describe('model slash commands', () => {
  it('matchCommands returns only /model for /model prefix', () => {
    const matches = matchCommands('/model');
    const names = matches.map(m => m.name);
    assert.ok(names.includes('/model'));
    assert.equal(names.filter(name => name.startsWith('/model')).length, 1);
  });

  it('SLASH_COMMANDS exposes a single model command', () => {
    const modelCmds = SLASH_COMMANDS.filter(c => c.name.startsWith('/model'));
    assert.equal(modelCmds.length, 1);
    assert.equal(modelCmds[0].name, '/model');
  });
});

describe('mcp slash commands', () => {
  it('matchCommands returns only /mcp for /mcp prefix', () => {
    const matches = matchCommands('/mcp');
    const names = matches.map(m => m.name);
    assert.ok(names.includes('/mcp'));
    assert.equal(names.filter(name => name.startsWith('/mcp')).length, 1);
  });

  it('SLASH_COMMANDS exposes a single mcp command', () => {
    const mcpCmds = SLASH_COMMANDS.filter(c => c.name.startsWith('/mcp'));
    assert.equal(mcpCmds.length, 1);
    assert.equal(mcpCmds[0].name, '/mcp');
  });
});

describe('template slash commands', () => {
  it('matchCommands returns only /template for /template prefix', () => {
    const matches = matchCommands('/template');
    const names = matches.map(m => m.name);
    assert.ok(names.includes('/template'));
    assert.equal(names.filter(name => name.startsWith('/template')).length, 1);
  });

  it('SLASH_COMMANDS exposes a single template command', () => {
    const templateCmds = SLASH_COMMANDS.filter(c => c.name.startsWith('/template'));
    assert.equal(templateCmds.length, 1);
    assert.equal(templateCmds[0].name, '/template');
  });
});

describe('model picker helpers', () => {
  const providers = [
    { id: 'openai', display_name: 'OpenAI' },
    { id: 'ollama', display_name: 'Ollama' },
  ];

  const models = [
    {
      provider_id: 'openai',
      provider_name: 'OpenAI',
      model_id: 'gpt-4o',
      model_name: 'GPT-4o',
      deployment: null,
      is_current: false,
    },
    {
      provider_id: 'ollama',
      provider_name: 'Ollama',
      model_id: 'gpt-oss:20b',
      model_name: 'GPT OSS 20B',
      deployment: 'local',
      is_current: true,
    },
    {
      provider_id: 'ollama',
      provider_name: 'Ollama',
      model_id: 'glm-5:cloud',
      model_name: 'GLM-5 Cloud',
      deployment: 'cloud',
      is_current: false,
    },
  ];

  it('buildModelPickerEntries groups by provider and keeps custom row', () => {
    const entries = buildModelPickerEntries(providers, models, '', null);
    assert.equal(entries[0].type, 'section');
    assert.equal(entries[0].label, 'Ollama');
    assert.equal(entries[1].type, 'model');
    assert.equal(entries[1].model_id, 'gpt-oss:20b');
    assert.equal(entries[2].type, 'model');
    assert.equal(entries[2].model_id, 'glm-5:cloud');
    assert.equal(entries[3].type, 'custom');
    assert.equal(entries[3].provider_id, 'ollama');
    assert.equal(entries[4].type, 'section');
    assert.equal(entries[4].label, 'OpenAI');
    assert.equal(entries[5].type, 'model');
    assert.equal(entries[5].model_id, 'gpt-4o');
    assert.equal(entries[6].type, 'custom');
    assert.equal(entries[6].provider_id, 'openai');
  });

  it('buildModelPickerEntries filters by query and preserves matching provider custom row', () => {
    const entries = buildModelPickerEntries(providers, models, 'oss', null);
    assert.equal(entries.length, 3);
    assert.equal(entries[0].type, 'section');
    assert.equal(entries[1].type, 'model');
    assert.equal(entries[1].model_id, 'gpt-oss:20b');
    assert.equal(entries[2].type, 'custom');
  });

  it('movePickerSelection skips section entries', () => {
    const entries = buildModelPickerEntries(providers, models, '', null);
    assert.equal(movePickerSelection(entries, 0, 1), 1);
    assert.equal(movePickerSelection(entries, 3, 1), 5);
    assert.equal(movePickerSelection(entries, 4, -1), 3);
  });

  it('clampPickerScroll keeps selected row inside viewport', () => {
    assert.equal(clampPickerScroll(12, 0, 5), 8);
    assert.equal(clampPickerScroll(2, 6, 5), 2);
    assert.equal(clampPickerScroll(3, 1, 5), 1);
  });
});

describe('input autocomplete helpers', () => {
  it('resolveAutocompleteSelection returns highlighted command when prefix is incomplete', () => {
    const selected = resolveAutocompleteSelection('/mo', [
      { name: '/model' },
      { name: '/mcp list' },
    ], 0);

    assert.equal(selected, '/model');
  });

  it('resolveAutocompleteSelection returns null when input already matches the selected command', () => {
    const selected = resolveAutocompleteSelection('/model', [
      { name: '/model' },
    ], 0);

    assert.equal(selected, null);
  });

  it('resolveAutocompleteSelection ignores invalid selection indexes', () => {
    const selected = resolveAutocompleteSelection('/mo', [
      { name: '/model' },
    ], 4);

    assert.equal(selected, null);
  });
});

describe('context utilization', () => {
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
});
