import type { WorkflowTrigger } from '@moxxy/sdk';

/**
 * Normalize a workflow display/file NAME to a filesystem slug. The single
 * slug authority shared by `/workflows new` (command.ts) and the store's
 * `uniqueFilename` (store.ts) so a hand-scaffolded file and a later
 * `store.create` of the same name land on the same on-disk filename.
 */
export function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

/**
 * One-line human summary of a workflow's triggers for list/inspect surfaces.
 * Shared by command.ts and tools.ts so the rendering can't drift (the two
 * copies had already diverged on the join separator).
 */
export function triggerSummary(on: WorkflowTrigger | undefined): string {
  if (!on) return 'on-demand';
  const parts: string[] = [];
  if (on.schedule?.cron) parts.push(`cron(${on.schedule.cron})`);
  if (on.schedule?.runAt) parts.push('runAt');
  if (on.afterWorkflow) parts.push(`after(${[on.afterWorkflow].flat().join(',')})`);
  if (on.fileChanged) parts.push('fileChanged');
  if (on.webhook) parts.push(`webhook(${on.webhook})`);
  return parts.length > 0 ? parts.join(' + ') : 'on-demand';
}
