import type { Skill, SkillRegistry } from '@moxxy/sdk';

export class SkillRegistryImpl implements SkillRegistry {
  private readonly byId = new Map<string, Skill>();
  private readonly byNameIdx = new Map<string, Skill>();

  list(): ReadonlyArray<Skill> {
    return [...this.byId.values()];
  }

  get(id: string): Skill | undefined {
    return this.byId.get(id);
  }

  byName(name: string): Skill | undefined {
    return this.byNameIdx.get(name);
  }

  filterByTriggers(prompt: string): ReadonlyArray<Skill> {
    const lower = prompt.toLowerCase();
    const matches: Skill[] = [];
    for (const skill of this.byId.values()) {
      const triggers = skill.frontmatter.triggers ?? [];
      if (triggers.some((t) => lower.includes(t.toLowerCase()))) matches.push(skill);
    }
    return matches;
  }

  register(skill: Skill): void {
    this.byId.set(skill.id, skill);
    this.byNameIdx.set(skill.frontmatter.name, skill);
  }

  unregister(id: string): void {
    const skill = this.byId.get(id);
    if (!skill) return;
    this.byId.delete(id);
    this.byNameIdx.delete(skill.frontmatter.name);
  }

  clear(): void {
    this.byId.clear();
    this.byNameIdx.clear();
  }
}
