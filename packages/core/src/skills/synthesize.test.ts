import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { LLMProvider, ProviderEvent } from '@moxxy/sdk';
import { Session } from '../session.js';
import { asSkillId, asTurnId, defineProvider, definePlugin } from '@moxxy/sdk';
import { synthesizeSkill, buildSynthesizeSkillPlugin } from './synthesize.js';

const DRAFT_DELTA =
  '---\nname: refactor-component\ndescription: Split a large React component.\ntriggers: ["refactor", "split"]\nallowed-tools: [Read, Edit]\n---\n# Steps\n\n1. Read the file.\n2. Identify boundaries.\n3. Edit into pieces.\n';

class InlineProvider implements LLMProvider {
  readonly name = 'inline';
  readonly models = [{ id: 'inline-1', contextWindow: 100_000, maxOutputTokens: 2000, supportsTools: true, supportsStreaming: true }];
  private cursor = 0;
  constructor(private readonly scripts: ReadonlyArray<ReadonlyArray<ProviderEvent>>) {}
  async *stream(): AsyncIterable<ProviderEvent> {
    const reply = this.scripts[this.cursor++];
    if (!reply) throw new Error('InlineProvider: no script left');
    for (const e of reply) yield e;
  }
  async countTokens(): Promise<number> { return 0; }
}

const draftReply = (): ReadonlyArray<ProviderEvent> => [
  { type: 'message_start', model: 'inline-1' },
  { type: 'text_delta', delta: DRAFT_DELTA },
  { type: 'message_end', stopReason: 'end_turn' },
];

let tmp: string;

const newSessionWithProvider = (provider: InlineProvider) => {
  const session = new Session({ cwd: '/tmp', silent: true });
  const providerPlugin = definePlugin({
    name: 'shim',
    providers: [
      defineProvider({ name: provider.name, models: [...provider.models], createClient: () => provider }),
    ],
  });
  session.pluginHost.registerStatic(providerPlugin);
  session.providers.setActive(provider.name);
  return session;
};

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'mox-synth-'));
});
afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});

describe('synthesizeSkill', () => {
  it('drafts a skill, writes it, registers, and emits SkillCreatedEvent', async () => {
    const provider = new InlineProvider([draftReply()]);
    const session = newSessionWithProvider(provider);

    const result = await synthesizeSkill(session, 'split component up', 'user', {
      userDir: path.join(tmp, 'skills'),
      auditPath: path.join(tmp, 'audit.jsonl'),
    });

    expect(result.scope).toBe('user');
    expect(result.skill.frontmatter.name).toBe('refactor-component');
    expect(result.path).toContain(path.join(tmp, 'skills'));

    const written = await fs.readFile(result.path, 'utf8');
    expect(written).toContain('refactor-component');

    expect(session.skills.byName('refactor-component')).toBeDefined();

    const createdEvents = session.log.ofType('skill_created');
    expect(createdEvents).toHaveLength(1);
    expect(createdEvents[0].name).toBe('refactor-component');

    const audit = await fs.readFile(path.join(tmp, 'audit.jsonl'), 'utf8');
    expect(audit).toContain('refactor-component');
  });

  it('stamps skill_created with the active turnId, not a fresh orphan turn', async () => {
    const provider = new InlineProvider([draftReply()]);
    const session = newSessionWithProvider(provider);
    const turnId = asTurnId('active-turn-1');

    await synthesizeSkill(
      session,
      'split component up',
      'user',
      { userDir: path.join(tmp, 'skills'), auditPath: path.join(tmp, 'audit.jsonl') },
      turnId,
    );

    const createdEvents = session.log.ofType('skill_created');
    expect(createdEvents).toHaveLength(1);
    // Must carry the active turn's id so run-turn's per-turn subscriber filter
    // (event.turnId !== turnId → drop) doesn't discard it. A fresh startTurn()
    // id would never match the running turn.
    expect(createdEvents[0].turnId).toBe(turnId);
  });

  it('uses project dir when scope=project', async () => {
    const provider = new InlineProvider([draftReply()]);
    const session = newSessionWithProvider(provider);

    const result = await synthesizeSkill(session, 'do x', 'project', {
      projectDir: path.join(tmp, 'project/.moxxy/skills'),
      auditPath: path.join(tmp, 'audit.jsonl'),
    });
    expect(result.scope).toBe('project');
    expect(result.path).toContain(path.join(tmp, 'project/.moxxy/skills'));
  });

  it('avoids overwriting existing files with -2 suffix', async () => {
    const provider = new InlineProvider([draftReply(), draftReply()]);
    const session = newSessionWithProvider(provider);

    const a = await synthesizeSkill(session, 'first', 'user', {
      userDir: path.join(tmp, 'skills'),
      auditPath: path.join(tmp, 'audit.jsonl'),
    });
    const b = await synthesizeSkill(session, 'second', 'user', {
      userDir: path.join(tmp, 'skills'),
      auditPath: path.join(tmp, 'audit.jsonl'),
    });
    expect(b.path).not.toBe(a.path);
    expect(b.path).toMatch(/-2\.md$/);
  });
});

describe('buildSynthesizeSkillPlugin', () => {
  it('registers synthesize_skill and reload_skills tools', () => {
    const provider = new InlineProvider([]);
    const session = newSessionWithProvider(provider);
    const plugin = buildSynthesizeSkillPlugin(session);
    session.pluginHost.registerStatic(plugin);
    expect(session.tools.has('synthesize_skill')).toBe(true);
    expect(session.tools.has('reload_skills')).toBe(true);
  });

  it('load_skill emits skill_invoked with the active turnId from ctx', async () => {
    const provider = new InlineProvider([]);
    const session = newSessionWithProvider(provider);
    session.pluginHost.registerStatic(buildSynthesizeSkillPlugin(session));
    // A pre-authored skill load_skill can resolve.
    session.skills.register({
      id: asSkillId('user/demo'),
      path: '/demo.md',
      scope: 'user',
      frontmatter: { name: 'demo', description: 'd' },
      body: 'steps',
    });

    const turnId = asTurnId('active-turn-2');
    // Drive the tool through the registry exactly as the loop does: the
    // ToolContext is built with the running turn's id, so the handler must
    // stamp skill_invoked with THAT id (not a fresh startTurn() orphan that the
    // run-turn subscriber filter would drop).
    await session.tools.execute(
      'load_skill',
      { name: 'demo' },
      session.signal,
      { turnId: String(turnId), sessionId: String(session.id), callId: 'c1' },
    );

    const invoked = session.log.ofType('skill_invoked');
    expect(invoked).toHaveLength(1);
    expect(invoked[0].turnId).toBe(turnId);
  });
});
