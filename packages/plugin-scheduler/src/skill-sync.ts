import type { Skill, SkillRegistry } from '@moxxy/sdk';
import { isValidCron } from './cron.js';
import type { ScheduleEntry, ScheduleStore } from './store.js';

/**
 * Reconcile schedules-from-skills with the persistent store. The skill
 * registry is the source of truth for `source='skill'` rows: any skill
 * with a `schedule:` frontmatter block contributes one entry; removed
 * skills (or skills that drop their `schedule:`) lose theirs.
 *
 * `source='manual'` rows are never touched.
 *
 * The scheduler poller calls this on every tick so changes to a skill
 * file (e.g. tweaking the cron in a `.md` and reloading) propagate
 * without a restart.
 */

function toEntryDraft(skill: Skill): Omit<ScheduleEntry, 'id' | 'createdAt'> | null {
  const s = skill.frontmatter.schedule;
  if (!s) return null;
  if (!s.cron && s.runAt === undefined) return null;
  if (s.cron && !isValidCron(s.cron)) return null;
  const runAt =
    s.runAt === undefined
      ? undefined
      : typeof s.runAt === 'string'
        ? Date.parse(s.runAt)
        : s.runAt;
  return {
    name: skill.frontmatter.name,
    // The body of the skill IS the prompt — the model that runs at
    // fire time will receive these instructions verbatim.
    prompt: skill.body.trim() || skill.frontmatter.description,
    ...(s.cron ? { cron: s.cron } : {}),
    ...(runAt !== undefined ? { runAt } : {}),
    ...(s.timeZone ? { timeZone: s.timeZone } : {}),
    ...(s.channel ? { channel: s.channel } : {}),
    enabled: s.enabled ?? true,
    source: 'skill',
    skillName: skill.frontmatter.name,
  };
}

/**
 * Compute the desired set of skill-driven schedules from the registry
 * and reconcile against the store. Idempotent — repeat calls are
 * cheap when nothing changed.
 */
export async function syncSkillSchedules(
  registry: SkillRegistry,
  store: ScheduleStore,
): Promise<{ added: number; removed: number; updated: number }> {
  const wanted = new Map<string, Omit<ScheduleEntry, 'id' | 'createdAt'>>();
  for (const skill of registry.list()) {
    const draft = toEntryDraft(skill);
    if (draft) wanted.set(skill.frontmatter.name, draft);
  }

  const existing = await store.list();
  const existingSkill = new Map<string, ScheduleEntry>();
  for (const e of existing) {
    if (e.source === 'skill' && e.skillName) existingSkill.set(e.skillName, e);
  }

  let added = 0;
  let removed = 0;
  let updated = 0;

  // Remove rows whose skill is gone or no longer carries schedule.
  for (const [skillName, entry] of existingSkill) {
    if (!wanted.has(skillName)) {
      const ok = await store.delete(entry.id);
      if (ok) removed += 1;
    }
  }

  // Upsert wanted rows.
  for (const [skillName, draft] of wanted) {
    const current = existingSkill.get(skillName);
    if (!current) {
      await store.create(draft);
      added += 1;
      continue;
    }
    const changed =
      current.prompt !== draft.prompt ||
      current.cron !== draft.cron ||
      current.runAt !== draft.runAt ||
      current.timeZone !== draft.timeZone ||
      current.channel !== draft.channel ||
      current.enabled !== draft.enabled;
    if (changed) {
      await store.update(current.id, {
        prompt: draft.prompt,
        ...(draft.cron ? { cron: draft.cron } : { cron: undefined }),
        ...(draft.runAt !== undefined ? { runAt: draft.runAt } : { runAt: undefined }),
        ...(draft.timeZone ? { timeZone: draft.timeZone } : { timeZone: undefined }),
        ...(draft.channel ? { channel: draft.channel } : { channel: undefined }),
        enabled: draft.enabled,
      });
      updated += 1;
    }
  }

  return { added, removed, updated };
}
