import type { SkillId } from './ids.js';

export interface SkillSchedule {
  readonly cron?: string;
  readonly runAt?: number | string;
  readonly timeZone?: string;
  readonly channel?: string;
  readonly enabled?: boolean;
}

export interface SkillFrontmatter {
  readonly name: string;
  readonly description: string;
  readonly triggers?: ReadonlyArray<string>;
  readonly 'allowed-tools'?: ReadonlyArray<string>;
  readonly version?: string;
  readonly tags?: ReadonlyArray<string>;
  readonly schedule?: SkillSchedule;
}

export type SkillScope = 'project' | 'user' | 'plugin' | 'builtin';

export interface Skill {
  readonly id: SkillId;
  readonly path: string;
  readonly scope: SkillScope;
  readonly frontmatter: SkillFrontmatter;
  readonly body: string;
}

export interface SkillDef {
  readonly frontmatter: SkillFrontmatter;
  readonly body: string;
}
