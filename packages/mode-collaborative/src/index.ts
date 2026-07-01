import { defineMode, definePlugin, type ModeDef } from '@moxxy/sdk';
import { COLLAB_MODE_NAME } from './constants.js';
import { runCollaborativeMode } from './collab-loop.js';
import { collabArchitectMode, collabPeerMode } from './modes.js';

/**
 * @moxxy/mode-collaborative — agentic collaborative mode. All three modes are
 * `special` (see {@link ModeDef.special}): the collaborative system is a
 * separate flow entered via the `/collab` command, never picked from `/mode` —
 * `collaborative` is the coordinator; `collab-architect`/`collab-peer` are the
 * internal roles the spawned agent processes run (via `MOXXY_MODE`).
 */
export const collaborativeMode: ModeDef = defineMode({
  name: COLLAB_MODE_NAME,
  description:
    'Agentic collaborative: a team of separate agents (an architect + implementers) work in parallel on one task.',
  badge: { label: 'TEAM', tone: 'attention' },
  special: { invokedBy: 'collab' },
  run: runCollaborativeMode,
});

export const collaborativeModePlugin = definePlugin({
  name: '@moxxy/mode-collaborative',
  version: '0.0.0',
  modes: [collaborativeMode, collabArchitectMode, collabPeerMode],
});

export default collaborativeModePlugin;

export {
  COLLAB_MODE_NAME,
  COLLAB_ARCHITECT_MODE_NAME,
  COLLAB_PEER_MODE_NAME,
  collabCoordinatorSocketPath,
} from './constants.js';
export { resolveCollabConfig, DEFAULT_COLLAB_CONFIG, type CollabConfig } from './config.js';
export {
  collabRunsDir,
  listRunRecords,
  readRunRecord,
  writeRunRecord,
  type CollabRunRecord,
  type CollabRunAgent,
} from './archive.js';
export { forceReleaseCollabLock, readActiveCollab, type CollabLockInfo } from './collab-lock.js';
// The on-disk-layout contract the desktop host reads directly off disk — the
// lock path, the defensive lock parse + liveness probe, and the runs dir +
// record shape — co-located with the coordinator that WRITES it so the two
// readers can't drift. (collabRunsDir / listRunRecords / CollabRunRecord are
// also surfaced via archive, which now re-exports them FROM this module — one
// identity, one source of truth.)
export {
  collabLockPath,
  isCollabHolderAlive,
  moxxyHome,
  parseCollabLock,
  readCollabLock,
} from './collab-store.js';
