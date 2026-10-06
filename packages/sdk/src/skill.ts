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
  /** Other names a prompt can call the skill by with an @ mention (`computer_use`; `_` and `-` read the same). */
  readonly aliases?: ReadonlyArray<string>;
  /** How the chat's @ menu shows the skill ("Computer Use"); a skill with one is offered first. */
  readonly label?: string;
  /** Tools withheld from a turn whose prompt calls the skill by an @ mention (`browser_*` or exact names). */
  readonly 'disallowed-tools'?: ReadonlyArray<string>;
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
