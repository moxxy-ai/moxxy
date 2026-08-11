import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { defineTool } from '@moxxy/sdk';
import { collectTurn } from '@moxxy/core';
import { createFakeSession, FakeProvider, textReply, toolUseReply } from '@moxxy/testing';

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
    const tools = readOnlyTools(session.tools);

    expect(tools.list().map((tool) => tool.name)).toEqual(['Read', 'plan_complete']);
    expect(tools.get('Bash')).toBeUndefined();
    await expect(tools.execute('Bash', {}, new AbortController().signal)).rejects.toThrow(
      'does not allow',
    );
    expect(mutationRan).toBe(false);
  });
});
