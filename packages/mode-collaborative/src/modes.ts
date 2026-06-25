/**
 * The two peer-side modes. Both run the shared autonomous loop; only the
 * system prompt differs (architect = design + contracts + roster; peer =
 * build to contracts + coordinate). They are selected inside the spawned
 * `moxxy agent` processes via MOXXY_MODE, not by the user directly.
 */

import { readFileSync } from 'node:fs';
import { defineMode, type ModeDef } from '@moxxy/sdk';
import { COLLAB_ENV } from '@moxxy/plugin-collab';
import { COLLAB_ARCHITECT_MODE_NAME, COLLAB_PEER_MODE_NAME } from './constants.js';
import { COLLAB_ARCHITECT_PROMPT, COLLAB_PEER_PROMPT, peerPromptWithCharter } from './prompts.js';
import { runCollabAgentLoop } from './agent-loop.js';

export const collabArchitectMode: ModeDef = defineMode({
  name: COLLAB_ARCHITECT_MODE_NAME,
  description: 'Collaboration architect (internal): designs the plan + shared contracts, then brokers.',
  badge: { label: 'ARCHITECT', tone: 'attention' },
  // Internal role mode — entered via the spawned agent's MOXXY_MODE, never picked.
  special: { invokedBy: "collab" },
  run: (ctx) => runCollabAgentLoop(ctx, { systemPrompt: COLLAB_ARCHITECT_PROMPT }),
});

/** Read this peer's architect-authored charter (if any) so it lands in the
 *  STATIC system-prompt prefix (cached once), not the per-turn message. Missing
 *  / unreadable → the generic peer prompt. */
function peerSystemPrompt(env: Readonly<Record<string, string | undefined>>): string {
  const path = env[COLLAB_ENV.CharterFile]?.trim();
  if (!path) return COLLAB_PEER_PROMPT;
  try {
    return peerPromptWithCharter(readFileSync(path, 'utf8'));
  } catch {
    return COLLAB_PEER_PROMPT;
  }
}

export const collabPeerMode: ModeDef = defineMode({
  name: COLLAB_PEER_MODE_NAME,
  description: 'Collaboration peer (internal): a team member building to the shared contracts.',
  badge: { label: 'TEAM', tone: 'attention' },
  // Internal role mode — entered via the spawned agent's MOXXY_MODE, never picked.
  special: { invokedBy: "collab" },
  run: (ctx) => runCollabAgentLoop(ctx, { systemPrompt: peerSystemPrompt(ctx.env) }),
});
