import type { WorkNode } from '@moxxy/client-core';
import { useActivityDisclosure } from './SkillGroupView';

function spent(ms: number): string | null {
  const seconds = Math.floor(ms / 1000);
  if (!Number.isFinite(seconds) || seconds < 1) return null;
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return seconds % 60 > 0 ? `${minutes}m ${seconds % 60}s` : `${minutes}m`;
  return minutes % 60 > 0 ? `${Math.floor(minutes / 60)}h ${minutes % 60}m` : `${Math.floor(minutes / 60)}h`;
}

/** The header of a turn's folded work: how long it took, and in how many steps. */
export function workGroupLabel(group: WorkNode): { readonly label: string; readonly steps: string } {
  const time = group.startedAtMs !== null && group.endedAtMs !== null ? spent(group.endedAtMs - group.startedAtMs) : null;
  return {
    label: time ? `Worked for ${time}` : 'Worked',
    steps: group.steps === 1 ? '1 step' : `${group.steps} steps`,
  };
}

/** A turn's folded work: closed until the person opens it. */
export function useWorkGroup(group: WorkNode): {
  readonly label: string;
  readonly steps: string;
  readonly open: boolean;
  readonly toggle: () => void;
} {
  const [open, toggle] = useActivityDisclosure();
  return { ...workGroupLabel(group), open, toggle };
}
