import { definePlugin } from '@moxxy/sdk';
import { collabTools } from './tools.js';
import { collabCommands } from './say-command.js';

/**
 * @moxxy/plugin-collab — the peer-side surface of agentic-collaborative mode.
 * It contributes the collab_* tools (inert outside a collaboration) and the
 * /collab_say command. The hub, state, client, and registries are exported for
 * the coordinator package (@moxxy/mode-collaborative) to host + drive.
 */
export const collabPlugin = definePlugin({
  name: '@moxxy/plugin-collab',
  version: '0.0.0',
  tools: [...collabTools],
  commands: [...collabCommands],
});

export default collabPlugin;

export * from './hub-types.js';
export * from './hub-protocol.js';
export { CollaborationState, pathsConflict, type CollaborationStateOptions } from './state.js';
export { createCollaborationHub, type CollaborationHub, type PeerReader, type CreateHubOptions } from './hub.js';
export { CollabHubClient } from './client.js';
export { registerActiveHub, getActiveHub, unregisterActiveHub } from './active-hubs.js';
export { COLLAB_ENV, isCollabPeer, getProcessHubClient, __resetProcessHubClient } from './process-client.js';
export { collabTools, PEER_TOOL_NAMES } from './tools.js';
export {
  collabCommands,
  collabSayCommand,
  collabDirectCommand,
  collabPauseCommand,
  collabResumeCommand,
} from './say-command.js';
