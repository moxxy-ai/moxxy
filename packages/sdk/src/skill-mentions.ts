import type { UserPromptAttachment } from './events.js';
import type { ToolRegistry } from './mode.js';
import type { SkillInfo } from './session-like.js';
import type { Skill } from './skill.js';

/** `@computer_use`, but not the `@` inside an e-mail address. */
const MENTION = /(?<![\p{L}\p{N}_@.])@(\p{L}[\p{L}\p{N}_-]*)/gu;

/** `computer_use`, `Computer-Use` and `computer-use` name the same skill; so do `przeglądarka` and `przegladarka`. */
const key = (name: string): string =>
  name.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').replace(/ł/gu, 'l').replace(/[_\s]+/gu, '-');

/** The skills a prompt calls by an @ mention of their name or an alias, each once, in mention order. */
export function mentionedSkills(text: string, skills: ReadonlyArray<Skill>): Skill[] {
  const byKey = new Map<string, Skill>();
  for (const skill of skills) {
    for (const name of [skill.frontmatter.name, ...(skill.frontmatter.aliases ?? [])]) byKey.set(key(name), skill);
  }
  const found = new Set<Skill>();
  for (const [, name] of text.matchAll(MENTION)) {
    const skill = byKey.get(key(name ?? ''));
    if (skill) found.add(skill);
  }
  return [...found];
}

/** The mentioned skill, recorded on the prompt so every surface and every replay sees the same request. */
export function skillAttachment(skill: Skill): UserPromptAttachment {
  const withheld = skill.frontmatter['disallowed-tools'] ?? [];
  const off = withheld.length > 0 ? ` The tools ${withheld.join(', ')} are off for this request.` : '';
  return {
    kind: 'file',
    name: `${skill.frontmatter.name} skill`,
    content: `The user called this skill with an @ mention: follow it for this request.${off}\n\n${skill.body}`,
  };
}

/** Whether a tool name fits an `allowed-tools`-style pattern (`browser_*` or an exact name). */
export function toolPatternMatches(pattern: string, name: string): boolean {
  return pattern.endsWith('*') ? name.startsWith(pattern.slice(0, -1)) : name === pattern;
}

/** The registry without the tools the patterns name: not offered to the model, and refused if called anyway. */
export function withoutTools(tools: ToolRegistry, patterns: ReadonlyArray<string>): ToolRegistry {
  const withheld = (name: string) => patterns.some((pattern) => toolPatternMatches(pattern, name));
  return {
    list: () => tools.list().filter((tool) => !withheld(tool.name)),
    get: (name) => (withheld(name) ? undefined : tools.get(name)),
    execute: async (name, input, signal, opts) => {
      if (withheld(name)) throw new Error(`${name} is off for this request: the user called a skill that rules it out`);
      return tools.execute(name, input, signal, opts);
    },
  };
}

/** The @ word being typed: where it starts (its `@`), where it ends, and what follows the `@`. */
export interface MentionQuery {
  readonly start: number;
  readonly end: number;
  readonly query: string;
}

const TYPED = /(?:^|[\s(])@([\p{L}\p{N}_-]*)$/u;
const REST = /^[\p{L}\p{N}_-]*/u;

/** The @ word the caret is in, or null when it is in none (an e-mail address is none). */
export function mentionQueryAt(text: string, caret: number): MentionQuery | null {
  const typed = TYPED.exec(text.slice(0, caret));
  if (!typed) return null;
  const query = typed[1] ?? '';
  const rest = REST.exec(text.slice(caret))?.[0] ?? '';
  return { start: caret - query.length - 1, end: caret + rest.length, query: query + rest };
}

/** One skill the @ menu offers: shown by `label`, inserted as `@token`. */
export interface MentionOption {
  readonly name: string;
  readonly token: string;
  readonly label: string;
  readonly description: string;
}

/**
 * The skills that answer an @ query: a word of a name, alias or label that starts with the query
 * before one that only holds it, skills with a label (the tool-like ones) first, then by label.
 */
export function mentionOptions(skills: ReadonlyArray<SkillInfo>, query: string, limit = 8): MentionOption[] {
  const wanted = key(query);
  const ranked = skills.flatMap((skill) => {
    const keys = [skill.name, ...(skill.aliases ?? []), ...(skill.label ? [skill.label] : [])].map(key);
    const rank = keys.some((k) => k.split('-').some((word) => word.startsWith(wanted)) || k.startsWith(wanted))
      ? 0
      : keys.some((k) => k.includes(wanted)) ? 1 : undefined;
    if (rank === undefined) return [];
    const option = { name: skill.name, token: skill.aliases?.[0] ?? skill.name, label: skill.label ?? skill.name, description: skill.description ?? '' };
    return [{ option, rank, labelled: skill.label ? 0 : 1 }];
  });
  ranked.sort((a, b) => a.rank - b.rank || a.labelled - b.labelled || a.option.label.localeCompare(b.option.label));
  return ranked.slice(0, limit).map((entry) => entry.option);
}

/** The text with the @ word replaced by `@token` and a space, and the caret after that space. */
export function insertMention(text: string, at: MentionQuery, token: string): { text: string; caret: number } {
  const after = text.slice(at.end);
  const spaced = /^\s/u.test(after) ? after : ` ${after}`;
  const next = `${text.slice(0, at.start)}@${token}${spaced}`;
  return { text: next, caret: at.start + token.length + 2 };
}
