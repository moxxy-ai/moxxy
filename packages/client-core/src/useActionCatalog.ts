/**
 * Loads the action catalog — the skills and tools the live session actually
 * has registered — so the workflow builder can offer pickers instead of
 * free-text name fields. Fetch-on-mount from `session.info` (the runner's
 * wire-friendly registry snapshot, also available to remote clients) +
 * refresh on {@link SESSION_INFO_REFRESH_EVENT} through the platform
 * {@link EventBus} capability, mirroring `useActiveModeBadge`.
 *
 * `loaded` stays false until `session.info` answers with a session — callers
 * should fall back to a plain text field in that state rather than claiming
 * "there are no skills".
 */

import { useEffect, useState } from 'react';
import type { SkillInfo, ToolInfo } from '@moxxy/sdk';
import { SESSION_INFO_REFRESH_EVENT } from '@moxxy/desktop-ipc-contract';
import { api } from './transport.js';
import { getPlatform } from './platform.js';

export interface ActionCatalog {
  /** True once `session.info` answered with a live session (even with empty lists). */
  readonly loaded: boolean;
  readonly skills: ReadonlyArray<SkillInfo>;
  readonly tools: ReadonlyArray<ToolInfo>;
}

const EMPTY: ActionCatalog = { loaded: false, skills: [], tools: [] };

export function useActionCatalog(workspaceId?: string): ActionCatalog {
  const [catalog, setCatalog] = useState<ActionCatalog>(EMPTY);

  useEffect(() => {
    let cancelled = false;
    const fetchCatalog = (): void => {
      void api()
        .invoke('session.info', workspaceId ? { workspaceId } : undefined)
        .then((info) => {
          if (cancelled || !info) return;
          setCatalog({ loaded: true, skills: info.skills, tools: info.tools });
        })
        .catch(() => {});
    };
    fetchCatalog();
    const off = getPlatform().eventBus?.on(SESSION_INFO_REFRESH_EVENT, fetchCatalog);
    return () => {
      cancelled = true;
      off?.();
    };
  }, [workspaceId]);

  return catalog;
}
