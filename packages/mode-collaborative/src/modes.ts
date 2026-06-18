/**
 * The two peer-side modes. Both run the shared autonomous loop; only the
 * system prompt differs (architect = design + contracts + roster; peer =
 * build to contracts + coordinate). They are selected inside the spawned
 * `moxxy agent` processes via MOXXY_MODE, not by the user directly.
 */

import { defineMode, type ModeDef } from '@moxxy/sdk';
import { COLLAB_ARCHITECT_MODE_NAME, COLLAB_PEER_MODE_NAME } from './constants.js';
import { COLLAB_ARCHITECT_PROMPT, COLLAB_PEER_PROMPT } from './prompts.js';
import { runCollabAgentLoop } from './agent-loop.js';

export const collabArchitectMode: ModeDef = defineMode({
  name: COLLAB_ARCHITECT_MODE_NAME,
  description: 'Collaboration architect (internal): designs the plan + shared contracts, then brokers.',
  badge: { label: 'ARCHITECT', tone: 'attention' },
  run: (ctx) => runCollabAgentLoop(ctx, { systemPrompt: COLLAB_ARCHITECT_PROMPT }),
});

export const collabPeerMode: ModeDef = defineMode({
  name: COLLAB_PEER_MODE_NAME,
  description: 'Collaboration peer (internal): an implementer building to the shared contracts.',
  badge: { label: 'TEAM', tone: 'attention' },
  run: (ctx) => runCollabAgentLoop(ctx, { systemPrompt: COLLAB_PEER_PROMPT }),
});
