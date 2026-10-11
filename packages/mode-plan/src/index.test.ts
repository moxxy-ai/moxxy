import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { defineTool } from '@moxxy/sdk';
import { collectTurn } from '@moxxy/core';
import { createFakeSession, FakeAgentProvider, FakeProvider, textReply, toolUseReply } from '@moxxy/testing';

import { PLAN_MODE_NAME, planDefinitionSchema, planMode, planModePlugin } from './index.js';
import { readOnlyTools } from './plan-loop.js';
import type { PlanDefinition } from './plan-tool.js';

const firstPlan: PlanDefinition = {
  title: 'Ship workspace onboarding',
  objective: 'Give a new developer one clear path from install to a verified first run.',
  approach: 'Use the existing init and TUI surfaces, removing choices that are not needed on first use.',
  assumptions: ['The CLI remains the primary personal-use entry point.'],
  questions: ['Should the first run create a project config automatically?'],
  steps: [
    {
      id: 'P1',
      title: 'Audit the current first run',
      outcome: 'Every decision shown before the first prompt is accounted for.',
      actions: ['Trace init, boot, and the empty TUI state.'],
      files: ['packages/cli', 'packages/plugin-cli'],
      verification: ['Run the built CLI in a clean temporary home.'],
    },
    {
      id: 'P2',
      title: 'Implement the golden path',
      outcome: 'A configured developer reaches a useful prompt without setup detours.',
      actions: ['Collapse optional setup behind progressive disclosure.'],
      dependsOn: ['P1'],
      verification: ['Cover first and repeat launches with tests.'],
    },
  ],
  risks: [{ risk: 'Existing users lose discoverability.', mitigation: 'Keep advanced setup under explicit commands.' }],
  recommendedMode: 'default',
  handoff: 'Implement the approved workspace onboarding plan above and verify the first-run path.',
};

describe('plan mode', () => {
  it('is a standing selectable mode, not an autonomous one-shot mode', () => {
    expect(planMode.name).toBe(PLAN_MODE_NAME);
    expect(planMode.special).toBeUndefined();
    expect(planMode.transient).toBeUndefined();
    expect(planMode.badge).toBeUndefined();
  });

  it('rejects plans with forward dependencies or autonomous handoff while decisions remain', () => {
    expect(
      planDefinitionSchema.safeParse({
        ...firstPlan,
        steps: [
          { ...firstPlan.steps[0], dependsOn: ['P2'] },
          firstPlan.steps[1],
        ],
      }).success,
    ).toBe(false);
    expect(
      planDefinitionSchema.safeParse({ ...firstPlan, recommendedMode: 'goal' }).success,
    ).toBe(false);
  });

  it('turns plan_complete into one readable plan with explicit handoff choices', async () => {
    const provider = new FakeProvider({
      script: [toolUseReply('plan_complete', firstPlan, 'plan-1')],
    });
    const session = createFakeSession({ provider });
    session.pluginHost.registerStatic(planModePlugin);
    session.modes.setActive(PLAN_MODE_NAME);

    // The control tool is scoped to plan mode; it must not pollute the default
    // mode's global tool catalog.
    expect(session.tools.get('plan_complete')).toBeUndefined();

    const events = await collectTurn(session, 'Design a simpler workspace onboarding flow');
    const final = events.filter((event) => event.type === 'assistant_message').at(-1);

    expect(final).toMatchObject({ type: 'assistant_message', source: 'system' });
    if (final?.type !== 'assistant_message') throw new Error('expected a final plan');
    expect(final.content).toContain('# Ship workspace onboarding');
    expect(final.content).toContain('1. **P1 — Audit the current first run**');
    expect(final.content).toContain('/mode default');
    expect(final.content).toContain('**Execution brief:** Implement the approved workspace onboarding plan');
    expect(final.content).toContain('/goal Execute the approved plan above.');
    expect(provider.received[0]?.tools?.map((tool) => tool.name)).toContain('plan_complete');
    expect(
      events.some(
        (event) => event.type === 'plugin_event' && event.subtype === 'plan_completed',
      ),
    ).toBe(true);
  });

  it('hands in the plan without asking the person, as plan_complete declares', async () => {
    const provider = new FakeProvider({
      script: [toolUseReply('plan_complete', firstPlan, 'plan-1')],
    });
    const session = createFakeSession({ provider });
    session.pluginHost.registerStatic(planModePlugin);
    session.modes.setActive(PLAN_MODE_NAME);
    const asked: string[] = [];
    session.setPermissionResolver({
      name: 'asks',
      check: async (call) => {
        asked.push(call.name);
        return { mode: 'deny', reason: 'the person was asked' };
      },
    });

    const events = await collectTurn(session, 'Design a simpler workspace onboarding flow');

    expect(asked).toEqual([]);
    expect(events.some((event) => event.type === 'plugin_event' && event.subtype === 'plan_completed')).toBe(true);
  });

  it('still refuses plan_complete where the person denied it', async () => {
    const provider = new FakeProvider({
      script: [toolUseReply('plan_complete', firstPlan, 'plan-1'), textReply('Understood.')],
    });
    const session = createFakeSession({ provider });
    session.pluginHost.registerStatic(planModePlugin);
    session.modes.setActive(PLAN_MODE_NAME);
    session.permissions.setImmutableRules({ allow: [], deny: [{ name: 'plan_complete', reason: 'no plans here' }] });

    const events = await collectTurn(session, 'Design a simpler workspace onboarding flow');

    expect(events.some((event) => event.type === 'tool_call_denied')).toBe(true);
    expect(events.some((event) => event.type === 'plugin_event' && event.subtype === 'plan_completed')).toBe(false);
  });

  it('keeps prior plans in context so the next turn can revise them', async () => {
    const revised: PlanDefinition = {
      ...firstPlan,
      title: 'Ship zero-choice workspace onboarding',
      questions: [],
    };
    const provider = new FakeProvider({
      script: [
        toolUseReply('plan_complete', firstPlan, 'plan-1'),
        toolUseReply('plan_complete', revised, 'plan-2'),
      ],
    });
    const session = createFakeSession({ provider });
    session.pluginHost.registerStatic(planModePlugin);
    session.modes.setActive(PLAN_MODE_NAME);

    await collectTurn(session, 'Plan onboarding');
    const second = await collectTurn(session, 'Remove the open question and make the first run zero-choice');

    expect(session.modes.getActiveName()).toBe(PLAN_MODE_NAME);
    const request = provider.received[1];
    const visibleText = request?.messages
      .flatMap((message) => message.content)
      .filter((content) => content.type === 'text')
      .map((content) => content.text)
      .join('\n');
    expect(visibleText).toContain('Ship workspace onboarding');
    expect(visibleText).toContain('Remove the open question');
    expect(
      second.some(
        (event) =>
          event.type === 'assistant_message' &&
          event.content.includes('# Ship zero-choice workspace onboarding'),
      ),
    ).toBe(true);
  });

  it('nudges a prose-only draft back into the structured completion tool', async () => {
    const provider = new FakeProvider({
      script: [textReply('Here is a rough plan.'), toolUseReply('plan_complete', firstPlan, 'plan-2')],
    });
    const session = createFakeSession({ provider });
    session.pluginHost.registerStatic(planModePlugin);
    session.modes.setActive(PLAN_MODE_NAME);

    const events = await collectTurn(session, 'Plan this carefully');
    const secondRequest = provider.received[1];
    const nudge = secondRequest?.messages
      .flatMap((message) => message.content)
      .find(
        (content) => content.type === 'text' && content.text.includes('Return the final plan through'),
      );

    expect(nudge).toBeDefined();
    expect(
      events.some(
        (event) => event.type === 'plugin_event' && event.subtype === 'plan_completed',
      ),
    ).toBe(true);
  });

  it('exposes only explicit read-only tools and blocks direct execution of mutations', async () => {
    let mutationRan = false;
    const session = createFakeSession({ provider: new FakeProvider({ script: [] }) });
    session.tools.register(
      defineTool({
        name: 'Read',
        description: 'read',
        inputSchema: z.object({}),
        handler: () => 'contents',
      }),
    );
    session.tools.register(
      defineTool({
        name: 'Bash',
        description: 'mutate',
        inputSchema: z.object({}),
        handler: () => {
          mutationRan = true;
          return 'ran';
        },
      }),
    );
    session.tools.register(
      defineTool({
        name: 'ask_user',
        description: 'ask',
        inputSchema: z.object({}),
        handler: () => 'answered',
      }),
    );
    const tools = readOnlyTools(session.tools);

    // Asking the person changes nothing, and planning is where a question helps most.
    expect(tools.list().map((tool) => tool.name)).toEqual(['Read', 'ask_user', 'plan_complete']);
    expect(tools.get('Bash')).toBeUndefined();
    await expect(tools.execute('Bash', {}, new AbortController().signal)).rejects.toThrow(
      'does not allow',
    );
    expect(mutationRan).toBe(false);
  });

  it('shows an agent connection own plan in the same plan card and ends the turn there', async () => {
    const plan = '# Fix `add` and cover it\n\n## Summary\n\n`add` subtracts. Make it add.\n';
    const provider = new FakeAgentProvider(async function* () {
      yield { type: 'message', text: 'Looking at math.js.', stopReason: 'tool_use' };
      yield { type: 'plan', text: plan };
    });
    const session = createFakeSession({ provider });
    session.pluginHost.registerStatic(planModePlugin);
    session.modes.setActive(PLAN_MODE_NAME);

    const events = await collectTurn(session, 'Plan the fix for add');

    expect(provider.steps).toHaveLength(1);
    expect(provider.steps[0]?.mode).toBe(PLAN_MODE_NAME);
    const card = events.find((event) => event.type === 'plugin_event' && event.subtype === 'plan_completed');
    // An agent plan is Markdown: the title comes from its heading, steps and a
    // suggested mode are not guessed.
    expect(card).toMatchObject({ type: 'plugin_event', payload: { title: 'Fix `add` and cover it', questions: 0 } });
    if (card?.type !== 'plugin_event') throw new Error('expected a plan card');
    expect(card.payload).not.toHaveProperty('steps');
    expect(card.payload).not.toHaveProperty('recommendedMode');
    const final = events.filter((event) => event.type === 'assistant_message').at(-1);
    expect(final).toMatchObject({ type: 'assistant_message', source: 'system', content: plan });
  });

  it('asks an agent without a plan of its own for its plan through plan_complete, and shows it in the plan card', async () => {
    const provider = new FakeAgentProvider(async function* (req) {
      if (provider.steps.length === 1) {
        yield { type: 'tool_call', callId: 'r1', name: 'Read', input: { file_path: 'README.md' } };
        yield { type: 'tool_result', callId: 'r1', ok: true, output: '# app' };
        yield { type: 'message', text: 'Here is my plan: first audit, then build.' };
        return;
      }
      await req.host.runTool({ callId: 'p1', name: 'plan_complete', input: firstPlan });
      yield { type: 'message', text: 'Plan submitted.' };
    });
    const session = createFakeSession({ provider });
    session.pluginHost.registerStatic(planModePlugin);
    session.modes.setActive(PLAN_MODE_NAME);
    const asked: string[] = [];
    session.setPermissionResolver({ name: 'asks', check: async (call) => (asked.push(call.name), { mode: 'allow' }) });

    const events = await collectTurn(session, 'Plan the onboarding');

    expect(asked).toEqual([]);
    expect(provider.steps).toHaveLength(2);
    expect(provider.steps[0]?.tools.map((tool) => tool.name)).toContain('plan_complete');
    expect(provider.steps[1]?.prompt[0]).toMatchObject({ type: 'text', text: expect.stringContaining('plan_complete') });
    const card = events.find((event) => event.type === 'plugin_event' && event.subtype === 'plan_completed');
    expect(card).toMatchObject({ payload: { title: firstPlan.title, steps: firstPlan.steps.length } });
  });

  it('leaves an agent with its own plan mode to finish its turn without a nudge', async () => {
    const provider = new FakeAgentProvider(
      async function* () {
        yield { type: 'message', text: 'Which database should I plan for?' };
      },
      'fake-agent',
      { agentOwns: { plan: true } },
    );
    const session = createFakeSession({ provider });
    session.pluginHost.registerStatic(planModePlugin);
    session.modes.setActive(PLAN_MODE_NAME);

    await collectTurn(session, 'Plan the storage');

    expect(provider.steps).toHaveLength(1);
  });
});
