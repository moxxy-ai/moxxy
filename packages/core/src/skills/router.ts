import type { LLMProvider, Skill } from '@moxxy/sdk';

export interface SkillMatch {
  readonly skill: Skill;
  readonly confidence: number;
  readonly reason: 'trigger_match' | 'classifier' | 'manual';
}

export interface RouterOptions {
  readonly skills: ReadonlyArray<Skill>;
  readonly provider?: LLMProvider;
  readonly classifierModel?: string;
}

export class SkillRouter {
  private readonly skills: ReadonlyArray<Skill>;
  private readonly provider?: LLMProvider;
  private readonly classifierModel: string;

  constructor(opts: RouterOptions) {
    this.skills = opts.skills;
    this.provider = opts.provider;
    this.classifierModel = opts.classifierModel ?? 'claude-haiku-4-5-20251001';
  }

  async resolve(prompt: string): Promise<SkillMatch | null> {
    const candidates = this.filterByTriggers(prompt);
    if (candidates.length === 0) return null;
    if (candidates.length === 1) {
      return { skill: candidates[0]!, confidence: 0.9, reason: 'trigger_match' };
    }
    if (this.provider) {
      const winner = await this.classify(prompt, candidates);
      if (winner) return { skill: winner, confidence: 0.7, reason: 'classifier' };
    }
    return { skill: candidates[0]!, confidence: 0.5, reason: 'trigger_match' };
  }

  filterByTriggers(prompt: string): ReadonlyArray<Skill> {
    const lower = prompt.toLowerCase();
    const out: Skill[] = [];
    for (const skill of this.skills) {
      const triggers = skill.frontmatter.triggers ?? [];
      if (triggers.some((t) => lower.includes(t.toLowerCase()))) out.push(skill);
    }
    return out;
  }

  private async classify(prompt: string, candidates: ReadonlyArray<Skill>): Promise<Skill | null> {
    if (!this.provider) return null;
    const list = candidates
      .map((s, i) => `${i + 1}. ${s.frontmatter.name} — ${s.frontmatter.description}`)
      .join('\n');
    const system =
      'You are a skill classifier. Given a user prompt and a list of candidate skills, ' +
      'reply with ONLY the number of the best-fit skill, or 0 if none.';
    let acc = '';
    for await (const event of this.provider.stream({
      model: this.classifierModel,
      system,
      messages: [
        {
          role: 'user',
          content: [{ type: 'text', text: `Prompt:\n${prompt}\n\nCandidates:\n${list}` }],
        },
      ],
    })) {
      if (event.type === 'text_delta') acc += event.delta;
    }
    const match = /(\d+)/.exec(acc);
    const index = match ? Number(match[1]) - 1 : -1;
    if (index < 0 || index >= candidates.length) return null;
    return candidates[index] ?? null;
  }
}

export function buildSkillIndexPrompt(skills: ReadonlyArray<Skill>): string {
  if (skills.length === 0) return '';
  const lines = skills.map((s) => `- ${s.frontmatter.name}: ${s.frontmatter.description}`);
  return `Available skills:\n${lines.join('\n')}`;
}
