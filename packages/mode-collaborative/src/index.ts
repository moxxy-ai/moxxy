import { defineMode, definePlugin, type ModeDef } from '@moxxy/sdk';
import { COLLAB_MODE_NAME } from './constants.js';
import { runCollaborativeMode } from './collab-loop.js';
import { collabArchitectMode, collabPeerMode } from './modes.js';

/**
 * @moxxy/mode-collaborative — agentic collaborative mode. The `collaborative`
 * mode is the user-selectable coordinator; `collab-architect` and `collab-peer`
 * are the internal modes the spawned agent processes run.
 */
export const collaborativeMode: ModeDef = defineMode({
  name: COLLAB_MODE_NAME,
  description:
    'Agentic collaborative: a team of separate agents (an architect + implementers) work in parallel on one task.',
  badge: { label: 'TEAM', tone: 'attention' },
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
