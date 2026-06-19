import type { Skill, SkillRegistry } from '@moxxy/sdk';
import { isValidCron, isValidTimeZone } from './cron.js';
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
  if (s.timeZone !== undefined && !isValidTimeZone(s.timeZone)) return null;
  const runAt =
    s.runAt === undefined
      ? undefined
      : typeof s.runAt === 'string'
        ? Date.parse(s.runAt)
        : s.runAt;
  // An unparseable string runAt (e.g. "next tuesday") yields NaN. NaN would be
  // rejected by scheduleEntrySchema (z.number().int()) deep inside the batched
  // reconcile write, throwing and aborting the WHOLE skill-sync — every other
  // skill's schedule with it. Skip this one skill instead (mirrors the
  // invalid-cron branch) so one malformed frontmatter can't brick the batch.
  if (typeof runAt === 'number' && Number.isNaN(runAt)) return null;
  // Reject a schedule that supplies BOTH cron and runAt — the documented
  // contract is exactly one. Silently taking the cron arm (as isDue does)
  // contradicts the skill author's intent and the SDK doc, so skip it.
  if (s.cron && runAt !== undefined) return null;
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

  // Hand the whole desired set to the store, which diffs add/remove/update and
  // commits them in ONE atomic write + fsync — previously this loop did one
  // whole-file serialization + fsync per changed row (write amplification on the
  // hot onInit / skill_created path).
  return store.reconcileSkillSchedules(wanted);
}
