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
import { clampAutocompleteScroll, resolveAutocompleteSelection } from '../src/tui/input-utils.js';
import {
  createMcpAddWizard,
  getMcpAddWizardPrompt,
  parseMcpCommandInput,
  submitMcpAddWizardValue,
} from '../src/tui/mcp-wizard.js';
import {
  buildVaultRemovePickerItems,
  createTemplateAssignWizard,
  createVaultRemoveWizard,
  createVaultSetWizard,
  getActionWizardPrompt,
  submitActionWizardValue,
} from '../src/tui/action-wizards.js';

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

describe('mcp option picker shape', () => {
  it('root /mcp should expose action-oriented picker labels only through a single command entry', () => {
    const matches = matchCommands('/mcp');
    assert.equal(matches.length, 1);
    assert.equal(matches[0].name, '/mcp');
  });
});

describe('mcp wizard helpers', () => {
  it('parseMcpCommandInput splits command and args for stdio transports', () => {
    assert.deepEqual(
      parseMcpCommandInput('npx -y chrome-devtools-mcp@latest'),
      {
        command: 'npx',
        args: ['-y', 'chrome-devtools-mcp@latest'],
      }
    );
  });

  it('parseMcpCommandInput preserves quoted arguments', () => {
    assert.deepEqual(
      parseMcpCommandInput('npx -y "@scope/server" "/tmp/my dir"'),
      {
        command: 'npx',
        args: ['-y', '@scope/server', '/tmp/my dir'],
      }
    );
  });

  it('stdio wizard asks for command first and then server id', () => {
    let wizard = createMcpAddWizard('stdio');
    assert.equal(getMcpAddWizardPrompt(wizard).label, 'Command');

    let result = submitMcpAddWizardValue(wizard, 'npx -y server-filesystem');
    assert.equal(result.done, false);
    wizard = result.wizard;
    assert.equal(getMcpAddWizardPrompt(wizard).label, 'Server ID');

    result = submitMcpAddWizardValue(wizard, 'filesystem');
    assert.equal(result.done, true);
    assert.deepEqual(result.payload, {
      transport: 'stdio',
      command: 'npx',
      args: ['-y', 'server-filesystem'],
      id: 'filesystem',
    });
  });

  it('sse wizard asks for url first and then server id', () => {
    let wizard = createMcpAddWizard('sse');
    assert.equal(getMcpAddWizardPrompt(wizard).label, 'Server URL');

    let result = submitMcpAddWizardValue(wizard, 'http://localhost:8080/sse');
    assert.equal(result.done, false);
    wizard = result.wizard;
    assert.equal(getMcpAddWizardPrompt(wizard).label, 'Server ID');

    result = submitMcpAddWizardValue(wizard, 'remote-sse');
    assert.equal(result.done, true);
    assert.deepEqual(result.payload, {
      transport: 'sse',
      url: 'http://localhost:8080/sse',
      id: 'remote-sse',
    });
  });

  it('wizard rejects empty values', () => {
    const wizard = createMcpAddWizard('stdio');
    const result = submitMcpAddWizardValue(wizard, '   ');
    assert.equal(result.done, false);
    assert.equal(result.error, 'Value cannot be empty.');
    assert.equal(result.wizard.step, 'command');
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

describe('vault remove picker helpers', () => {
  it('builds picker items from secrets returned by the vault API', () => {
    const items = buildVaultRemovePickerItems([
      {
        id: 'sec_1',
        key_name: 'OPENAI_API_KEY',
        backend_key: 'OPENAI_API_KEY',
        policy_label: 'default',
      },
      {
        id: 'sec_2',
        key_name: 'ANTHROPIC_API_KEY',
        backend_key: 'anthropic-prod',
        policy_label: null,
      },
    ]);

    assert.deepEqual(items, [
      {
        label: 'OPENAI_API_KEY',
        description: 'backend=OPENAI_API_KEY [default]',
        command: '/vault remove OPENAI_API_KEY',
      },
      {
        label: 'ANTHROPIC_API_KEY',
        description: 'backend=anthropic-prod',
        command: '/vault remove ANTHROPIC_API_KEY',
      },
    ]);
  });

  it('returns an empty picker list when secrets are missing', () => {
    assert.deepEqual(buildVaultRemovePickerItems(null), []);
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

  it('clampAutocompleteScroll scrolls the suggestion window when selection moves below the viewport', () => {
    assert.equal(clampAutocompleteScroll(0, 0, 5, 10), 0);
    assert.equal(clampAutocompleteScroll(4, 0, 5, 10), 0);
    assert.equal(clampAutocompleteScroll(5, 0, 5, 10), 1);
    assert.equal(clampAutocompleteScroll(8, 1, 5, 10), 4);
  });

  it('clampAutocompleteScroll clamps to available rows when the list shrinks', () => {
    assert.equal(clampAutocompleteScroll(2, 6, 5, 4), 0);
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

describe('skill visual rendering in events handler', () => {
  it('skill.execute invocation creates a skill message with steps array', () => {
    const h = new EventsHandler({}, 'agent-1');

    h._processEvent({
      event_type: 'primitive.invoked',
      payload: { name: 'skill.execute', arguments: { name: 'git clone' } },
      ts: 1000,
    });

    assert.equal(h.messages.length, 1);
    const msg = h.messages[0];
    assert.equal(msg.type, 'skill');
    assert.equal(msg.name, 'git clone');
    assert.equal(msg.status, 'running');
    assert.ok(Array.isArray(msg.steps));
    assert.equal(msg.steps.length, 0);
  });

  it('skill.execute with string arguments is parsed correctly', () => {
    const h = new EventsHandler({}, 'agent-1');

    h._processEvent({
      event_type: 'primitive.invoked',
      payload: { name: 'skill.execute', arguments: '{"name":"deploy-app"}' },
      ts: 1000,
    });

    assert.equal(h.messages.length, 1);
    assert.equal(h.messages[0].name, 'deploy-app');
  });

  it('subsequent tools nest as steps under the active skill', () => {
    const h = new EventsHandler({}, 'agent-1');

    // Start skill
    h._processEvent({
      event_type: 'primitive.invoked',
      payload: { name: 'skill.execute', arguments: { name: 'git clone' } },
      ts: 1000,
    });

    // skill.execute completes (returns instructions)
    h._processEvent({
      event_type: 'primitive.completed',
      payload: { name: 'skill.execute', result: { name: 'Git Clone', instructions: '...' } },
      ts: 1001,
    });

    // Tool invoked within skill
    h._processEvent({
      event_type: 'primitive.invoked',
      payload: { name: 'git.clone', arguments: { url: 'https://...' } },
      ts: 1002,
    });

    // Should still only have 1 message (the skill), not a separate tool
    assert.equal(h.messages.length, 1);
    const skill = h.messages[0];
    assert.equal(skill.name, 'Git Clone'); // updated from result
    assert.equal(skill.steps.length, 1);
    assert.equal(skill.steps[0].name, 'git.clone');
    assert.equal(skill.steps[0].status, 'running');

    // Tool completes
    h._processEvent({
      event_type: 'primitive.completed',
      payload: { name: 'git.clone', result: { status: 'cloned' } },
      ts: 1003,
    });

    assert.equal(skill.steps[0].status, 'completed');
    assert.ok(skill.steps[0].result);
  });

  it('multiple tools within a skill are all nested', () => {
    const h = new EventsHandler({}, 'agent-1');

    h._processEvent({
      event_type: 'primitive.invoked',
      payload: { name: 'skill.execute', arguments: { name: 'deploy' } },
      ts: 1000,
    });
    h._processEvent({
      event_type: 'primitive.completed',
      payload: { name: 'skill.execute', result: { name: 'Deploy' } },
      ts: 1001,
    });

    // Three tools
    for (const toolName of ['git.clone', 'fs.write', 'git.commit']) {
      h._processEvent({ event_type: 'primitive.invoked', payload: { name: toolName }, ts: 1002 });
      h._processEvent({ event_type: 'primitive.completed', payload: { name: toolName, result: 'ok' }, ts: 1003 });
    }

    assert.equal(h.messages.length, 1); // Still only the skill message
    const skill = h.messages[0];
    assert.equal(skill.steps.length, 3);
    assert.equal(skill.steps[0].name, 'git.clone');
    assert.equal(skill.steps[1].name, 'fs.write');
    assert.equal(skill.steps[2].name, 'git.commit');
    assert.ok(skill.steps.every(s => s.status === 'completed'));
  });

  it('message.final closes active skill and marks it completed', () => {
    const h = new EventsHandler({}, 'agent-1');

    h._processEvent({
      event_type: 'primitive.invoked',
      payload: { name: 'skill.execute', arguments: { name: 'test-skill' } },
      ts: 1000,
    });
    h._processEvent({
      event_type: 'primitive.completed',
      payload: { name: 'skill.execute', result: { name: 'Test Skill' } },
      ts: 1001,
    });

    h._processEvent({
      event_type: 'primitive.invoked',
      payload: { name: 'fs.write' },
      ts: 1002,
    });
    h._processEvent({
      event_type: 'primitive.completed',
      payload: { name: 'fs.write', result: 'ok' },
      ts: 1003,
    });

    // message.final ends the skill
    h._processEvent({
      event_type: 'message.final',
      payload: { content: 'Done!' },
      ts: 1004,
    });

    assert.equal(h.messages[0].status, 'completed');
    assert.equal(h._activeSkillIdx, null);
    // Also creates an assistant message
    assert.equal(h.messages[1].type, 'assistant');
  });

  it('run.completed closes active skill', () => {
    const h = new EventsHandler({}, 'agent-1');

    h._processEvent({
      event_type: 'primitive.invoked',
      payload: { name: 'skill.execute', arguments: { name: 'my-skill' } },
      ts: 1000,
    });

    h._processEvent({
      event_type: 'run.completed',
      payload: {},
      ts: 1002,
    });

    assert.equal(h.messages[0].status, 'completed');
    assert.equal(h._activeSkillIdx, null);
  });

  it('run.failed marks active skill as error', () => {
    const h = new EventsHandler({}, 'agent-1');

    h._processEvent({
      event_type: 'primitive.invoked',
      payload: { name: 'skill.execute', arguments: { name: 'my-skill' } },
      ts: 1000,
    });

    h._processEvent({
      event_type: 'run.failed',
      payload: { error: 'timeout' },
      ts: 1002,
    });

    assert.equal(h.messages[0].status, 'error');
    assert.equal(h._activeSkillIdx, null);
  });

  it('skill.execute failure marks the skill as error', () => {
    const h = new EventsHandler({}, 'agent-1');

    h._processEvent({
      event_type: 'primitive.invoked',
      payload: { name: 'skill.execute', arguments: { name: 'bad-skill' } },
      ts: 1000,
    });

    h._processEvent({
      event_type: 'primitive.failed',
      payload: { name: 'skill.execute', error: 'skill not found' },
      ts: 1001,
    });

    assert.equal(h.messages.length, 1);
    assert.equal(h.messages[0].status, 'error');
    assert.equal(h.messages[0].error, 'skill not found');
    assert.equal(h._activeSkillIdx, null);
  });

  it('tool failure within skill marks the step as error', () => {
    const h = new EventsHandler({}, 'agent-1');

    h._processEvent({
      event_type: 'primitive.invoked',
      payload: { name: 'skill.execute', arguments: { name: 'deploy' } },
      ts: 1000,
    });
    h._processEvent({
      event_type: 'primitive.completed',
      payload: { name: 'skill.execute', result: { name: 'Deploy' } },
      ts: 1001,
    });

    h._processEvent({
      event_type: 'primitive.invoked',
      payload: { name: 'git.push' },
      ts: 1002,
    });
    h._processEvent({
      event_type: 'primitive.failed',
      payload: { name: 'git.push', error: 'permission denied' },
      ts: 1003,
    });

    const skill = h.messages[0];
    assert.equal(skill.status, 'running'); // skill itself is still running
    assert.equal(skill.steps[0].status, 'error');
    assert.equal(skill.steps[0].error, 'permission denied');
  });

  it('second skill.execute closes the first skill', () => {
    const h = new EventsHandler({}, 'agent-1');

    h._processEvent({
      event_type: 'primitive.invoked',
      payload: { name: 'skill.execute', arguments: { name: 'skill-1' } },
      ts: 1000,
    });

    h._processEvent({
      event_type: 'primitive.completed',
      payload: { name: 'skill.execute', result: { name: 'Skill 1' } },
      ts: 1001,
    });

    h._processEvent({
      event_type: 'primitive.invoked',
      payload: { name: 'fs.write' },
      ts: 1002,
    });
    h._processEvent({
      event_type: 'primitive.completed',
      payload: { name: 'fs.write', result: 'ok' },
      ts: 1003,
    });

    // Second skill.execute
    h._processEvent({
      event_type: 'primitive.invoked',
      payload: { name: 'skill.execute', arguments: { name: 'skill-2' } },
      ts: 1004,
    });

    assert.equal(h.messages.length, 2);
    assert.equal(h.messages[0].name, 'Skill 1');
    assert.equal(h.messages[0].status, 'completed'); // auto-closed
    assert.equal(h.messages[0].steps.length, 1);
    assert.equal(h.messages[1].name, 'skill-2');
    assert.equal(h.messages[1].status, 'running');
  });

  it('tools without active skill are shown as normal tool messages', () => {
    const h = new EventsHandler({}, 'agent-1');

    h._processEvent({
      event_type: 'primitive.invoked',
      payload: { name: 'fs.read', arguments: { path: '/tmp' } },
      ts: 1000,
    });

    assert.equal(h.messages.length, 1);
    assert.equal(h.messages[0].type, 'tool');
    assert.equal(h.messages[0].name, 'fs.read');
    assert.equal(h.messages[0].status, 'invoked');
  });

  it('tools after skill completes are shown as normal tool messages', () => {
    const h = new EventsHandler({}, 'agent-1');

    // Skill session
    h._processEvent({
      event_type: 'primitive.invoked',
      payload: { name: 'skill.execute', arguments: { name: 'my-skill' } },
      ts: 1000,
    });
    h._processEvent({
      event_type: 'primitive.completed',
      payload: { name: 'skill.execute', result: { name: 'My Skill' } },
      ts: 1001,
    });

    // Close via message.final
    h._processEvent({
      event_type: 'message.final',
      payload: { content: 'Done' },
      ts: 1002,
    });

    // Tool after skill completed
    h._processEvent({
      event_type: 'primitive.invoked',
      payload: { name: 'fs.read', arguments: { path: '/tmp' } },
      ts: 1003,
    });

    assert.equal(h.messages.length, 3); // skill, assistant, tool
    assert.equal(h.messages[2].type, 'tool');
    assert.equal(h.messages[2].name, 'fs.read');
  });

  it('skill.invoked event also creates a skill with steps', () => {
    const h = new EventsHandler({}, 'agent-1');

    h._processEvent({
      event_type: 'skill.invoked',
      payload: { name: 'custom-skill' },
      ts: 1000,
    });

    assert.equal(h.messages.length, 1);
    assert.equal(h.messages[0].type, 'skill');
    assert.equal(h.messages[0].name, 'custom-skill');
    assert.ok(Array.isArray(h.messages[0].steps));
  });

  it('skill.completed event closes the skill', () => {
    const h = new EventsHandler({}, 'agent-1');

    h._processEvent({
      event_type: 'skill.invoked',
      payload: { name: 'custom-skill' },
      ts: 1000,
    });
    h._processEvent({
      event_type: 'skill.completed',
      payload: { name: 'custom-skill' },
      ts: 1001,
    });

    assert.equal(h.messages[0].status, 'completed');
    assert.equal(h._activeSkillIdx, null);
  });

  it('skill.failed event marks skill as error', () => {
    const h = new EventsHandler({}, 'agent-1');

    h._processEvent({
      event_type: 'skill.invoked',
      payload: { name: 'custom-skill' },
      ts: 1000,
    });
    h._processEvent({
      event_type: 'skill.failed',
      payload: { name: 'custom-skill', error: 'boom' },
      ts: 1001,
    });

    assert.equal(h.messages[0].status, 'error');
    assert.equal(h.messages[0].error, 'boom');
    assert.equal(h._activeSkillIdx, null);
  });
});
