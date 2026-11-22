/**
 * The models the person's Codex offers their account, as its own picker lists
 * them: a short-lived `codex app-server` is asked `model/list`, page by page,
 * and closed again. The pages are a recorded Codex 0.171.0 answer; Codex is
 * the external boundary.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { FakeCodex } from './fake-codex.testkit.js';
import { codexOfferedModels } from './offered-models.js';
import { codexAgentModels } from './agent-provider.js';

const recorded = JSON.parse(readFileSync(new URL('./fixtures/codex-model-list-0.171.0.json', import.meta.url), 'utf8')) as {
  pages: ReadonlyArray<{ data: ReadonlyArray<Record<string, unknown>>; nextCursor?: string | null }>;
};
const nothing = async () => undefined;

describe("the models the person's Codex offers", () => {
  it('lists every page, in Codex order, and leaves no Codex running', async () => {
    const codex = new FakeCodex(nothing, { modelPages: recorded.pages });

    const models = await codexOfferedModels('/work/app', codex.start);

    expect(models.map((m) => m.id)).toEqual([
      'gpt-6.2-sol',
      'gpt-6.2-astra',
      'gpt-6.1-terra',
      'gpt-6.1-sol',
      'gpt-6-astra',
      'gpt-6-sol',
      'gpt-6-luna',
      'gpt-5.6-sol',
      'gpt-5.6-terra',
      'gpt-5.6-luna',
    ]);
    expect(codex.last.sent('model/list')).toEqual([{}, { cursor: '6' }]);
    expect(codex.last.closed).toBe(true);
  });

  it('describes each model as an agent model: tools, images, reasoning, and fast where Codex offers it', async () => {
    const codex = new FakeCodex(nothing, { modelPages: recorded.pages });

    const [sol] = await codexOfferedModels('/work/app', codex.start);

    expect(sol).toMatchObject({ id: 'gpt-6.2-sol', supportsTools: true, supportsImages: true, supportsReasoning: true, supportsFast: true });
    expect(sol?.contextWindow).toBe(500_000);
  });

  it('gives each model the reasoning levels Codex lists for it: ultra on sol, up to max on luna', async () => {
    const codex = new FakeCodex(nothing, { modelPages: recorded.pages });

    const offered = await codexOfferedModels('/work/app', codex.start);

    const levels = Object.fromEntries(offered.map((model) => [model.id, model.reasoningEfforts]));
    expect(levels['gpt-6-sol']).toEqual(['low', 'medium', 'high', 'xhigh', 'max', 'ultra']);
    expect(levels['gpt-6-luna']).toEqual(['low', 'medium', 'high', 'xhigh', 'max']);
    expect(levels['gpt-5.6-luna']).toEqual(['low', 'medium', 'high', 'xhigh', 'max']);
  });

  it('has the built-in models, used until Codex answers, name the same levels Codex lists', async () => {
    const codex = new FakeCodex(nothing, { modelPages: recorded.pages });
    const offered = await codexOfferedModels('/work/app', codex.start);

    for (const builtIn of codexAgentModels) {
      expect({ id: builtIn.id, levels: builtIn.reasoningEfforts }).toEqual({
        id: builtIn.id,
        levels: offered.find((model) => model.id === builtIn.id)?.reasoningEfforts,
      });
    }
  });

  it("knows every model Codex lists, with the context window of Codex's own catalog, until Codex reports the window it runs", async () => {
    const codex = new FakeCodex(nothing, { modelPages: recorded.pages });
    const offered = await codexOfferedModels('/work/app', codex.start);

    expect(offered.map((model) => model.id).filter((id) => !codexAgentModels.some((builtIn) => builtIn.id === id))).toEqual([]);
    const windows = Object.fromEntries(offered.map((model) => [model.id, model.contextWindow]));
    expect(windows).toMatchObject({ 'gpt-6.2-sol': 500_000, 'gpt-6.2-astra': 272_000, 'gpt-6.1-terra': 500_000, 'gpt-6.1-sol': 500_000, 'gpt-6-astra': 272_000 });
  });

  it('keeps only the levels Moxxy knows, and none for a model that does not reason', async () => {
    const [first] = recorded.pages;
    if (!first) throw new Error('recording has no pages');
    const odd = {
      ...first.data[0],
      id: 'gpt-odd',
      supportedReasoningEfforts: [{ reasoningEffort: 'none' }, { reasoningEffort: 'low' }, { reasoningEffort: 'hyper' }, 'bad'],
    };
    const flat = { ...first.data[0], id: 'gpt-flat', supportedReasoningEfforts: [] };
    const codex = new FakeCodex(nothing, { modelPages: [{ data: [odd, flat], nextCursor: null }] });

    const [oddModel, flatModel] = await codexOfferedModels('/work/app', codex.start);

    expect(oddModel?.reasoningEfforts).toEqual(['low']);
    expect(flatModel).toMatchObject({ supportsReasoning: false });
    expect(flatModel?.reasoningEfforts).toBeUndefined();
  });

  it('starts the GPT-6 models at the 272k window Codex runs them with by default', async () => {
    const codex = new FakeCodex(nothing, { modelPages: recorded.pages });

    const offered = await codexOfferedModels('/work/app', codex.start);

    const gpt6 = offered.filter((model) => model.id.startsWith('gpt-6-'));
    expect(gpt6.length).toBeGreaterThan(0);
    expect(gpt6.map((model) => model.contextWindow)).toEqual(gpt6.map(() => 272_000));
  });

  it('gives a model Moxxy does not know a 400k window', async () => {
    const [first] = recorded.pages;
    if (!first) throw new Error('recording has no pages');
    const codex = new FakeCodex(nothing, { modelPages: [{ data: [{ ...first.data[0], id: 'gpt-7-sol', model: 'gpt-7-sol' }], nextCursor: null }] });

    const [next] = await codexOfferedModels('/work/app', codex.start);

    expect(next).toMatchObject({ id: 'gpt-7-sol', contextWindow: 400_000, maxOutputTokens: 128_000, supportsTools: true });
  });

  it('leaves out models Codex hides from its picker', async () => {
    const [first] = recorded.pages;
    if (!first) throw new Error('recording has no pages');
    const hidden = { ...first.data[0], id: 'gpt-internal', model: 'gpt-internal', hidden: true };
    const codex = new FakeCodex(nothing, { modelPages: [{ data: [hidden, first.data[1]], nextCursor: null }] });

    expect((await codexOfferedModels('/work/app', codex.start)).map((m) => m.id)).toEqual(['gpt-6.2-astra']);
  });

  it('fails when Codex cannot be started, so the last list stays', async () => {
    const missing = async () => Promise.reject(new Error('spawn codex ENOENT'));

    await expect(codexOfferedModels('/work/app', missing)).rejects.toThrow(/ENOENT/);
  });

  it('gives up on a Codex that does not answer', async () => {
    const codex = new FakeCodex(nothing, { modelPages: recorded.pages });
    codex.silent = true;

    await expect(codexOfferedModels('/work/app', codex.start, { timeoutMs: 50 })).rejects.toThrow(/did not answer/);
    expect(codex.last.closed).toBe(true);
  });
});
