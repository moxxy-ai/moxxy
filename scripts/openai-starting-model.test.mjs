import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from 'node:http';
import test from 'node:test';
import { Session, collectTurn } from '../packages/core/dist/index.js';
import { defaultModePlugin } from '../packages/mode-default/dist/index.js';
import { openaiPlugin } from '../packages/plugin-provider-openai/dist/index.js';

test('OpenAI first requests honor the starter, the configured model, and the ongoing conversation', async () => {
  const models = [];
  let turn;
  const server = createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    models.push(JSON.parse(Buffer.concat(chunks)).model);
    // The assertion concerns the outgoing request. End this turn before a model response.
    turn.abort();
    response.destroy();
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const baseURL = `http://127.0.0.1:${server.address().port}/v1`;
  const sessions = [];
  function conversation(defaultModel) {
    const session = new Session({ cwd: process.cwd(), silent: true });
    sessions.push(session);
    session.pluginHost.registerStatic(defaultModePlugin);
    session.pluginHost.registerStatic(openaiPlugin);
    session.providers.setActive('openai', { apiKey: 'local-test', baseURL, maxRetries: 0 });
    if (defaultModel) session.defaultModels = { openai: defaultModel };
    return session;
  }
  async function ask(session, options) {
    const index = models.length;
    turn = new AbortController();
    const signal = AbortSignal.any([turn.signal, AbortSignal.timeout(10_000)]);
    try {
      await collectTurn(session, 'Model selection check.', { ...options, signal });
    } catch (error) {
      if (!turn.signal.aborted) throw error;
    }
    assert.equal(models.length, index + 1);
    return models[index];
  }
  try {
    assert.equal(await ask(conversation()), 'gpt-6-luna');
    const configured = conversation('gpt-6-astra');
    assert.equal(await ask(configured), 'gpt-6-astra');
    assert.equal(await ask(configured, { model: 'gpt-6-sol' }), 'gpt-6-sol');
    assert.equal(await ask(configured), 'gpt-6-sol');
  } finally {
    await Promise.all(sessions.map(session => session.close()));
    await new Promise(resolve => server.close(resolve));
  }
});
