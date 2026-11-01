import { useState } from 'react';
import { useDesks } from '@moxxy/client-core';
import type { Desk } from '@moxxy/desktop-ipc-contract';
import { folderName } from '@/lib/folder-name';

export interface UseWorkspaceStep {
  readonly folder: string | null;
  readonly name: string;
  readonly setName: (name: string) => void;
  readonly creating: boolean;
  readonly error: string | null;
  readonly canCreate: boolean;
  /** The workspace a skip keeps working in, or null. */
  readonly current: Desk | null;
  readonly count: number;
  readonly pickFolder: () => Promise<void>;
  readonly create: () => Promise<void>;
}

const DEFAULT_NAME = 'My workspace';

/**
 * The first-workspace step: pick a folder, name it, create it and make it the
 * active one. Moves on as soon as the workspace exists: on a first run its
 * agent starts only after setup finishes, minutes later, and activating it
 * already shows it while that happens.
 */
export function useWorkspaceStep(onNext: () => void): UseWorkspaceStep {
  const desks = useDesks();
  const [folder, setFolder] = useState<string | null>(null);
  const [name, setName] = useState(DEFAULT_NAME);
  const [creating, setCreating] = useState(false);
  const [failed, setFailed] = useState(false);

  const pickFolder = async (): Promise<void> => {
    const picked = await desks.pickFolder();
    if (!picked) return;
    setFolder(picked);
    setName(folderName(picked) ?? DEFAULT_NAME);
    setFailed(false);
  };

  const create = async (): Promise<void> => {
    if (!folder || !name.trim()) return;
    setCreating(true);
    setFailed(false);
    try {
      const desk = await desks.create(name.trim(), folder);
      if (!desk) {
        setFailed(true);
        return;
      }
      void desks.setActive(desk.id);
      onNext();
    } finally {
      setCreating(false);
    }
  };

  return {
    folder,
    name,
    setName,
    creating,
    error: failed ? (desks.error ?? 'Could not create the workspace.') : null,
    canCreate: folder !== null && name.trim() !== '' && !creating,
    current: desks.desks.find((desk) => desk.id === desks.activeId) ?? null,
    count: desks.desks.length,
    pickFolder,
    create,
  };
}
