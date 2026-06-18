import { describe, expect, it } from 'vitest';
import type { LLMProvider, ProviderEvent } from '@moxxy/sdk';
import { draftSkill } from './synthesize-draft.js';

/**
 * `draftSkill` streams the model's output, then unwraps any ```markdown fence
 * (its private `extractMarkdownBlock`) before parsing frontmatter. These tests
 * drive that unwrapping end-to-end through the public `draftSkill` entrypoint
 * with a scripted provider — no real LLM — asserting `raw` is the unwrapped
 * document and that the frontmatter/body split lines up.
 */

const FRONTMATTER =
  '---\nname: demo-skill\ndescription: A demo.\ntriggers: ["a", "b"]\nallowed-tools: [Read]\n---\n# Body\n\n1. Do the thing.\n';

class ScriptedProvider implements LLMProvider {
  readonly name = 'scripted';
  readonly models = [
    { id: 'm1', contextWindow: 100_000, maxOutputTokens: 2000, supportsTools: true, supportsStreaming: true },
  ];
  constructor(private readonly events: ReadonlyArray<ProviderEvent>) {}
  async *stream(): AsyncIterable<ProviderEvent> {
    for (const e of this.events) yield e;
  }
  async countTokens(): Promise<number> {
    return 0;
  }
}

const deltas = (...chunks: string[]): ProviderEvent[] => [
  { type: 'message_start', model: 'm1' },
  ...chunks.map((delta) => ({ type: 'text_delta', delta }) as ProviderEvent),
  { type: 'message_end', stopReason: 'end_turn' },
];

async function run(events: ProviderEvent[]) {
  const provider = new ScriptedProvider(events);
  return draftSkill(provider, 'm1', 'make a demo skill', new AbortController().signal);
}

describe('draftSkill / extractMarkdownBlock unwrapping', () => {
  it('returns the raw markdown verbatim when the model emits no code fence', async () => {
    const draft = await run(deltas(FRONTMATTER));
    expect(draft.raw).toBe(FRONTMATTER);
    expect(draft.frontmatter.name).toBe('demo-skill');
    expect(draft.body).toContain('Do the thing.');
  });

  it('unwraps a ```markdown fenced block (strips fence + language tag)', async () => {
    const fenced = '```markdown\n' + FRONTMATTER + '```';
    const draft = await run(deltas('Sure, here you go:\n', fenced));
    // The leading prose and the fence markers are stripped; only the inner doc
    // survives into `raw`, and parses cleanly.
    expect(draft.raw).toBe(FRONTMATTER);
    expect(draft.frontmatter.name).toBe('demo-skill');
  });

  it('unwraps a bare ``` fenced block (no language tag)', async () => {
    const fenced = '```\n' + FRONTMATTER + '```';
    const draft = await run(deltas(fenced));
    expect(draft.raw).toBe(FRONTMATTER);
  });

  it('extracts the FIRST fenced block when the model wraps and then chatters', async () => {
    const out = '```md\n' + FRONTMATTER + '```\nLet me know if you want changes!';
    const draft = await run(deltas(out));
    expect(draft.raw).toBe(FRONTMATTER);
    expect(draft.raw).not.toContain('Let me know');
  });

  it('surfaces a provider error event as a thrown error', async () => {
    await expect(
      run([
        { type: 'message_start', model: 'm1' },
        { type: 'error', message: 'boom', retryable: false },
      ]),
    ).rejects.toThrow(/provider error: boom/);
  });
});
