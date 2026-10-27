/**
 * The models the person's Claude offers their account, as its own picker lists
 * them: an Agent SDK `query()` that is sent no message answers
 * `supportedModels()` and is closed, so no turn runs and no usage is spent.
 * The list is a recorded SDK 0.3.296 answer; the SDK is the external boundary.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { FakeClaude } from './fake-claude.testkit.js';
import { claudeOfferedModels } from './offered-models.js';
import type { ClaudeModelInfo } from './sdk-types.js';

const recorded = JSON.parse(
  readFileSync(new URL('./fixtures/claude-supported-models-0.3.296.json', import.meta.url), 'utf8'),
) as { models: ReadonlyArray<ClaudeModelInfo> };
const nothing = async () => undefined;

function claude(models: ReadonlyArray<ClaudeModelInfo> = recorded.models): FakeClaude {
  const fake = new FakeClaude(nothing);
  fake.models = models;
  return fake;
}

describe("the models the person's Claude offers", () => {
  it('lists each model once by its full id, current ones first, and sends Claude nothing', async () => {
    const sdk = claude();

    const models = await claudeOfferedModels({ sdk, cwd: '/work/app' });

    expect(models.map((m) => m.id).slice(0, 4)).toEqual(['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-fable-5-1', 'claude-haiku-5-5']);
    expect(new Set(models.map((m) => m.id)).size).toBe(models.length);
    expect(models.map((m) => m.id)).not.toContain('default');
    expect(sdk.last.options.cwd).toBe('/work/app');
    expect(sdk.last.closed).toBe(true);
  });

  it('starts Claude from the CLI the connection uses', async () => {
    const sdk = claude();

    await claudeOfferedModels({ sdk, cwd: '/work/app', executable: '/usr/local/bin/claude' });

    expect(sdk.last.options.pathToClaudeCodeExecutable).toBe('/usr/local/bin/claude');
  });

  it('keeps what Moxxy knows of a model and describes a new one as an agent model', async () => {
    const sdk = claude([
      { value: 'opus', resolvedModel: 'claude-opus-5-5', displayName: 'Opus 5.5', description: '' },
      { value: 'claude-opus-6', displayName: 'Opus 6', description: '', supportsFastMode: true },
    ]);

    const [opus, next] = await claudeOfferedModels({ sdk, cwd: '/work/app' });

    expect(opus).toMatchObject({ id: 'claude-opus-5-5', contextWindow: 1_000_000, supportsTools: true });
    expect(next).toMatchObject({ id: 'claude-opus-6', supportsTools: true, supportsImages: true, supportsReasoning: true });
    expect(next?.contextWindow).toBe(400_000);
  });

  it('offers no Fast switch, even for a model Claude can run fast: Moxxy does not drive that mode', async () => {
    const sdk = claude([{ value: 'opus', resolvedModel: 'claude-opus-5-5', displayName: 'Opus 5.5', description: '', supportsFastMode: true }]);

    const [opus] = await claudeOfferedModels({ sdk, cwd: '/work/app' });

    expect(opus?.supportsFast).toBeUndefined();
  });

  it('knows Haiku 5.5 has a 1M window and 128k of output', async () => {
    const sdk = claude([{ value: 'haiku', resolvedModel: 'claude-haiku-5-5', displayName: 'Haiku 5.5', description: '' }]);

    const [haiku] = await claudeOfferedModels({ sdk, cwd: '/work/app' });

    expect(haiku).toMatchObject({ id: 'claude-haiku-5-5', contextWindow: 1_000_000, maxOutputTokens: 128_000 });
  });

  it('closes Claude even when it cannot list its models', async () => {
    const sdk = claude();
    sdk.models = new Error('Claude exited');

    await expect(claudeOfferedModels({ sdk, cwd: '/work/app' })).rejects.toThrow(/Claude exited/);
    expect(sdk.last.closed).toBe(true);
  });
});
