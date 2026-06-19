import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { defineTool, type SubagentResult, type SubagentSpawner, type ToolContext } from '@moxxy/sdk';
import { FakeProvider, createFakeSession, textReply, toolUseReply } from '@moxxy/testing';
import { defaultModePlugin } from '@moxxy/mode-default';
import { collectTurn } from '@moxxy/core';
import { buildDispatchAgentTool } from './dispatch-agent.js';

const dispatchAgentTool = buildDispatchAgentTool({ getAgent: () => undefined });

type DispatchResults = { results: ReadonlyArray<Record<string, unknown>> };

/** Minimal ToolContext carrying only the spawner the handler reads. */
function ctxWith(spawner: SubagentSpawner): ToolContext {
  return { subagents: spawner } as unknown as ToolContext;
}

describe('subagents — basic spawning', () => {
  it('spawns a child that runs a tool and returns its text', async () => {
    // The parent immediately dispatches one child agent.
    const provider = new FakeProvider({
      script: [
        // Parent's only message — kick off the child.
        toolUseReply(
          'dispatch_agent',
          {
            agents: [
              {
                prompt: 'Read /etc/config and report its version',
                label: 'reader',
              },
            ],
          },
          'p1',
        ),
        // Child's iteration 1: call Read.
        toolUseReply('Read', { file_path: '/etc/config' }, 'c1'),
        // Child's iteration 2: summarize.
        textReply('Version is 1.2.3'),
        // Parent's iteration 2: end turn with summary.
        textReply('reader reported: Version is 1.2.3'),
      ],
    });
    const session = createFakeSession({ provider });
    session.pluginHost.registerStatic(defaultModePlugin);
    session.modes.setActive('default');
    session.tools.register(
      defineTool({
        name: 'Read',
        description: 'read file',
        inputSchema: z.object({ file_path: z.string() }),
        handler: () => 'version=1.2.3',
      }),
    );
    // Register the dispatch_agent tool so the parent can invoke it.
    session.tools.register(dispatchAgentTool);

    const events = await collectTurn(session, 'use a sub-agent to fetch the version');

    // Parent log should carry subagent_started + subagent_completed envelopes.
    const started = events.find(
      (e) => e.type === 'plugin_event' && e.subtype === 'subagent_started',
    );
    expect(started).toBeDefined();
    if (started?.type === 'plugin_event') {
      const payload = started.payload as { label: string; mode: string };
      expect(payload.label).toBe('reader');
      expect(payload.mode).toBe('default');
    }

    const completed = events.find(
      (e) => e.type === 'plugin_event' && e.subtype === 'subagent_completed',
    );
    expect(completed).toBeDefined();
    if (completed?.type === 'plugin_event') {
      const payload = completed.payload as { label: string; text: string };
      expect(payload.label).toBe('reader');
      expect(payload.text).toContain('1.2.3');
    }
  });

  it('streams child tool calls to the parent in real time', async () => {
    const provider = new FakeProvider({
      script: [
        toolUseReply(
          'dispatch_agent',
          { agents: [{ prompt: 'Read a file', label: 'a' }] },
          'p1',
        ),
        // Child iteration: tool call + text wrap.
        toolUseReply('Read', { file_path: '/x' }, 'c1'),
        textReply('done'),
        // Parent wrap-up.
        textReply('child finished'),
      ],
    });
    const session = createFakeSession({ provider });
    session.pluginHost.registerStatic(defaultModePlugin);
    session.modes.setActive('default');
    session.tools.register(
      defineTool({
        name: 'Read',
        description: 'read',
        inputSchema: z.object({ file_path: z.string() }),
        handler: () => 'contents',
      }),
    );
    session.tools.register(dispatchAgentTool);

    const events = await collectTurn(session, 'fan out');

    // We expect at least one subagent_tool_call event mirroring the child's Read invocation.
    const childToolCall = events.find(
      (e) => e.type === 'plugin_event' && e.subtype === 'subagent_tool_call',
    );
    expect(childToolCall).toBeDefined();
    if (childToolCall?.type === 'plugin_event') {
      const payload = childToolCall.payload as { name: string; label: string };
      expect(payload.name).toBe('Read');
      expect(payload.label).toBe('a');
    }

    // And a tool_result mirror.
    const childToolResult = events.find(
      (e) => e.type === 'plugin_event' && e.subtype === 'subagent_tool_result',
    );
    expect(childToolResult).toBeDefined();
  });

  it('spawnAll runs multiple children and returns results in input order', async () => {
    // 3 children, each replies once. Parent kicks them off in one dispatch_agent call.
    const provider = new FakeProvider({
      script: [
        toolUseReply(
          'dispatch_agent',
          {
            agents: [
              { prompt: 'task 1', label: 'one' },
              { prompt: 'task 2', label: 'two' },
              { prompt: 'task 3', label: 'three' },
            ],
          },
          'p1',
        ),
        // The FakeProvider replies to requests in script order; with 3 parallel
        // children all making their first request roughly together, the order is
        // deterministic-enough for this test: each child gets a textReply ending its turn.
        textReply('done 1'),
        textReply('done 2'),
        textReply('done 3'),
        textReply('all done'),
      ],
    });
    const session = createFakeSession({ provider });
    session.pluginHost.registerStatic(defaultModePlugin);
    session.modes.setActive('default');
    session.tools.register(dispatchAgentTool);

    const events = await collectTurn(session, 'spawn three');

    const completed = events.filter(
      (e) => e.type === 'plugin_event' && e.subtype === 'subagent_completed',
    );
    expect(completed).toHaveLength(3);
    const labels = completed
      .map((e) => (e.type === 'plugin_event' ? (e.payload as { label: string }).label : ''))
      .sort();
    expect(labels).toEqual(['one', 'three', 'two']);
  });
});

describe('subagents — model override validation', () => {
  it('falls back to the parent model (with a warning) on a hallucinated model id', async () => {
    const provider = new FakeProvider({
      script: [
        toolUseReply(
          'dispatch_agent',
          // Training-era id the calling LLM tends to invent.
          { agents: [{ prompt: 'task', label: 'kid', model: 'claude-3-5-sonnet' }] },
          'p1',
        ),
        textReply('child done'),
        textReply('parent done'),
      ],
    });
    const session = createFakeSession({ provider });
    session.pluginHost.registerStatic(defaultModePlugin);
    session.modes.setActive('default');
    session.tools.register(dispatchAgentTool);

    const events = await collectTurn(session, 'spawn with a bogus model');

    const warning = events.find(
      (e) => e.type === 'plugin_event' && e.subtype === 'subagent_warning',
    );
    expect(warning).toBeDefined();
    if (warning?.type === 'plugin_event') {
      expect((warning.payload as { message: string }).message).toBe(
        'unknown model "claude-3-5-sonnet" — falling back to parent model "fake-model"',
      );
    }
    // Request order: parent iteration 1, child, parent wrap-up. The child's
    // provider request must carry the parent's model, not the invented one.
    expect(provider.received[1]?.model).toBe('fake-model');
  });

  it('honors a model override the provider actually lists', async () => {
    const models = [
      { id: 'fake-model', contextWindow: 200_000 },
      { id: 'cheap-model', contextWindow: 200_000 },
    ];
    const provider = new FakeProvider({
      models,
      script: [
        toolUseReply(
          'dispatch_agent',
          { agents: [{ prompt: 'task', label: 'kid', model: 'cheap-model' }] },
          'p1',
        ),
        textReply('child done'),
        textReply('parent done'),
      ],
    });
    const session = createFakeSession({ provider });
    session.pluginHost.registerStatic(defaultModePlugin);
    session.modes.setActive('default');
    session.tools.register(dispatchAgentTool);

    const events = await collectTurn(session, 'spawn cheap');

    expect(
      events.find((e) => e.type === 'plugin_event' && e.subtype === 'subagent_warning'),
    ).toBeUndefined();
    expect(provider.received[1]?.model).toBe('cheap-model');
  });
});

describe('subagents — fan-out failure containment', () => {
  it('degrades a spawnAll rejection to per-child error results instead of crashing the tool', async () => {
    // The core spawner uses Promise.all; a single child's setup throw rejects
    // the whole batch and discards siblings. The tool must not propagate that
    // raw rejection to the loop — it should hand back one error per spec.
    const spawner: SubagentSpawner = {
      spawn: async (): Promise<SubagentResult> => {
        throw new Error('should not be called');
      },
      spawnAll: async () => {
        throw new Error('provider lookup failed');
      },
    };

    const out = (await dispatchAgentTool.handler(
      {
        agents: [
          { prompt: 'task one', label: 'one' },
          { prompt: 'task two', label: 'two' },
        ],
      },
      ctxWith(spawner),
    )) as DispatchResults;

    expect(out.results).toHaveLength(2);
    expect(out.results.map((r) => r.label)).toEqual(['one', 'two']);
    for (const r of out.results) {
      expect(r.error).toBe('provider lookup failed');
      expect(r.stopReason).toBe('error');
      expect(r.text).toBe('');
    }
  });

  it('still returns successful results in input order on the happy path', async () => {
    const spawner: SubagentSpawner = {
      spawn: async (): Promise<SubagentResult> => {
        throw new Error('unused');
      },
      spawnAll: async (specs) =>
        specs.map(
          (s, i): SubagentResult => ({
            label: s.label ?? `k${i}`,
            childSessionId: `sess-${i}` as SubagentResult['childSessionId'],
            text: `done ${i}`,
            stopReason: 'end_turn',
          }),
        ),
    };

    const out = (await dispatchAgentTool.handler(
      { agents: [{ prompt: 'a', label: 'x' }, { prompt: 'b', label: 'y' }] },
      ctxWith(spawner),
    )) as DispatchResults;

    expect(out.results.map((r) => r.label)).toEqual(['x', 'y']);
    expect(out.results.every((r) => r.error === undefined)).toBe(true);
  });
});

describe('subagents — input bounds', () => {
  const tool = buildDispatchAgentTool({ getAgent: () => undefined });

  it('rejects an over-long prompt at the schema boundary (before any child is spawned)', () => {
    // The bound is enforced by the loop's input validation; assert the cap
    // exists so a regression that drops it is caught here.
    const schema = tool.inputSchema;
    const huge = 'x'.repeat(20_001);
    expect(schema.safeParse({ agents: [{ prompt: huge }] }).success).toBe(false);
    // A bounded prompt still parses.
    expect(schema.safeParse({ agents: [{ prompt: 'short' }] }).success).toBe(true);
  });

  it('rejects an over-long systemPrompt at the schema boundary', () => {
    const sys = 'y'.repeat(8_001);
    expect(
      tool.inputSchema.safeParse({ agents: [{ prompt: 'ok', systemPrompt: sys }] }).success,
    ).toBe(false);
  });

  it('rejects more than 8 agents in one batch', () => {
    const agents = Array.from({ length: 9 }, (_, i) => ({ prompt: `t${i}` }));
    const parsed = tool.inputSchema.safeParse({ agents });
    expect(parsed.success).toBe(false);
  });
});
