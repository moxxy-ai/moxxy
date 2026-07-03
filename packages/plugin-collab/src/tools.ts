/**
 * The peer-side collab_* tools. Registered globally (inert outside a
 * collaboration), enabled + auto-approved inside the architect/peer modes.
 * Each is a thin wrapper over the process hub client; identity (`from`/`self`)
 * is the hub's job, so these tools never carry an agent id.
 */

import { defineTool, type ToolDef, type ToolIsolationSpec } from '@moxxy/sdk';
import { z } from 'zod';
import { getProcessHubClient } from './process-client.js';

const NOT_IN_COLLAB = {
  error: 'Not in a collaboration. The collab_* tools only work for an agent running inside an agentic-collaborative team.',
};

/**
 * Every collab_* tool is a thin JSON-RPC round-trip over the hub's unix
 * socket (`$MOXXY_COLLAB_HUB`, under `~/.moxxy/collab/<runId>/`): no TCP
 * network and no subprocesses — peer spawning lives in
 * `@moxxy/mode-collaborative`, not in these handlers. The fs grant covers
 * the socket path an fs-sandboxing isolator must let the client dial.
 */
const HUB_RPC_ISOLATION: ToolIsolationSpec = {
  capabilities: {
    fs: { read: ['~/.moxxy/collab/**'], write: ['~/.moxxy/collab/**'] },
    net: { mode: 'none' },
    env: ['MOXXY_COLLAB_HUB', 'MOXXY_COLLAB_AGENT_ID', 'MOXXY_RUNNER_SOCKET'],
    timeMs: 30_000,
  },
};

/**
 * Variant for tools whose INPUT carries workspace file paths (claims,
 * contract artifacts): the cap checker validates path-shaped inputs against
 * `fs`, so the workspace must be in scope even though the paths only travel
 * to the hub as data — this process never opens them.
 */
const HUB_RPC_WORKSPACE_ISOLATION: ToolIsolationSpec = {
  capabilities: {
    ...HUB_RPC_ISOLATION.capabilities,
    fs: { read: ['$cwd/**', '~/.moxxy/collab/**'], write: ['~/.moxxy/collab/**'] },
  },
};

/**
 * Peer-inspection tools: same hub RPC, but the hub answers by reading files
 * or running git (status/diff) in the peer's worktree, so a round-trip can
 * legitimately take much longer than a board/messaging call.
 */
const HUB_RPC_PEER_ISOLATION: ToolIsolationSpec = {
  capabilities: {
    ...HUB_RPC_WORKSPACE_ISOLATION.capabilities,
    timeMs: 120_000,
  },
};

const collabSend = defineTool({
  name: 'collab_send',
  description:
    'Send a direct message to one teammate by their agent id (see collab_roster). Use for hand-offs, questions, and review requests.',
  inputSchema: z.object({
    to: z.string().describe('Recipient agent id'),
    body: z.string().min(1),
    subject: z.string().optional(),
  }),
  permission: { action: 'allow' },
  isolation: HUB_RPC_ISOLATION,
  handler: async ({ to, body, subject }) => {
    const c = await getProcessHubClient();
    if (!c) return NOT_IN_COLLAB;
    return c.post(to, body, subject);
  },
});

const collabBroadcast = defineTool({
  name: 'collab_broadcast',
  description: 'Broadcast a message to the whole team (everyone\'s inbox). Use for status updates and announcements.',
  inputSchema: z.object({ body: z.string().min(1), subject: z.string().optional() }),
  permission: { action: 'allow' },
  isolation: HUB_RPC_ISOLATION,
  handler: async ({ body, subject }) => {
    const c = await getProcessHubClient();
    if (!c) return NOT_IN_COLLAB;
    return c.post('all', body, subject);
  },
});

const collabInbox = defineTool({
  name: 'collab_inbox',
  description: 'Read messages addressed to you (and team broadcasts) since you last checked. Call this at the start of each work cycle.',
  inputSchema: z.object({}),
  permission: { action: 'allow' },
  isolation: HUB_RPC_ISOLATION,
  handler: async () => {
    const c = await getProcessHubClient();
    if (!c) return NOT_IN_COLLAB;
    const { messages } = await c.inbox();
    return messages.length === 0 ? { messages: [], note: 'No new messages.' } : { messages };
  },
});

const collabRoster = defineTool({
  name: 'collab_roster',
  description: 'List the team: every agent\'s id, role, sub-task, and current status. Use to learn who to coordinate with.',
  inputSchema: z.object({}),
  permission: { action: 'allow' },
  isolation: HUB_RPC_ISOLATION,
  handler: async () => {
    const c = await getProcessHubClient();
    if (!c) return NOT_IN_COLLAB;
    return c.roster();
  },
});

const collabBoard = defineTool({
  name: 'collab_board',
  description: 'Read the shared task board: items, statuses, owners, and claimed file paths.',
  inputSchema: z.object({}),
  permission: { action: 'allow' },
  isolation: HUB_RPC_ISOLATION,
  handler: async () => {
    const c = await getProcessHubClient();
    if (!c) return NOT_IN_COLLAB;
    return c.boardRead();
  },
});

const collabAddTask = defineTool({
  name: 'collab_add_task',
  description: 'Add a task to the shared board. Optionally declare the files it covers (to claim them).',
  inputSchema: z.object({
    title: z.string().min(1),
    detail: z.string().optional(),
    paths: z.array(z.string()).optional(),
  }),
  permission: { action: 'allow' },
  isolation: HUB_RPC_WORKSPACE_ISOLATION,
  handler: async ({ title, detail, paths }) => {
    const c = await getProcessHubClient();
    if (!c) return NOT_IN_COLLAB;
    return c.boardAdd(title, detail, paths);
  },
});

const collabClaim = defineTool({
  name: 'collab_claim',
  description:
    'Claim exclusive ownership of one or more files BEFORE editing them. If another agent already owns an overlapping path the claim is rejected — message that owner instead of editing.',
  inputSchema: z.object({
    paths: z.array(z.string()).min(1),
    id: z.string().optional().describe('Existing board item to attach the claim to'),
  }),
  permission: { action: 'allow' },
  isolation: HUB_RPC_WORKSPACE_ISOLATION,
  handler: async ({ paths, id }) => {
    const c = await getProcessHubClient();
    if (!c) return NOT_IN_COLLAB;
    const res = await c.boardClaim(paths, id);
    if (!res.ok) {
      return {
        claimed: false,
        ownedBy: res.ownedBy,
        message: `Those paths are owned by "${res.ownedBy}". Coordinate via collab_send before editing.`,
      };
    }
    return { claimed: true, item: res.item };
  },
});

const collabRelease = defineTool({
  name: 'collab_release',
  description: 'Release a file claim (or a board item) when you are done editing, so others can pick it up.',
  inputSchema: z.object({ id: z.string().optional(), paths: z.array(z.string()).optional() }),
  permission: { action: 'allow' },
  isolation: HUB_RPC_WORKSPACE_ISOLATION,
  handler: async ({ id, paths }) => {
    const c = await getProcessHubClient();
    if (!c) return NOT_IN_COLLAB;
    return c.boardRelease({ id, paths });
  },
});

const collabUpdate = defineTool({
  name: 'collab_update',
  description: 'Update a board item\'s status (open | claimed | in_progress | blocked | done) and/or detail.',
  inputSchema: z.object({
    id: z.string(),
    status: z.enum(['open', 'claimed', 'in_progress', 'blocked', 'done']).optional(),
    detail: z.string().optional(),
  }),
  permission: { action: 'allow' },
  isolation: HUB_RPC_ISOLATION,
  handler: async ({ id, status, detail }) => {
    const c = await getProcessHubClient();
    if (!c) return NOT_IN_COLLAB;
    return c.boardUpdate(id, status, detail);
  },
});

const collabDone = defineTool({
  name: 'collab_done',
  description: 'Declare YOUR sub-task complete and verified. Provide a short summary (and any artifact paths). The run ends when everyone is done.',
  inputSchema: z.object({ summary: z.string().min(1), artifacts: z.array(z.string()).optional() }),
  permission: { action: 'allow' },
  isolation: HUB_RPC_ISOLATION,
  handler: async ({ summary, artifacts }) => {
    const c = await getProcessHubClient();
    if (!c) return NOT_IN_COLLAB;
    return c.done(summary, artifacts);
  },
});

const collabContracts = defineTool({
  name: 'collab_contracts',
  description: 'List the shared contracts (agreed interfaces/boundaries) you must build to, with owner, consumers, and status.',
  inputSchema: z.object({}),
  permission: { action: 'allow' },
  isolation: HUB_RPC_ISOLATION,
  handler: async () => {
    const c = await getProcessHubClient();
    if (!c) return NOT_IN_COLLAB;
    return c.contracts();
  },
});

const collabContractPublish = defineTool({
  name: 'collab_contract_publish',
  description:
    'Publish a shared contract (an agreed interface/type/API shape). Normally the architect does this up front; an owner may publish the concrete interface for a boundary they own.',
  inputSchema: z.object({
    title: z.string().min(1),
    spec: z.string().min(1).describe('The interface/shape — signatures, types, endpoints'),
    owner: z.string().optional(),
    consumers: z.array(z.string()).optional(),
    artifactPath: z.string().optional(),
  }),
  permission: { action: 'allow' },
  isolation: HUB_RPC_WORKSPACE_ISOLATION,
  handler: async (input) => {
    const c = await getProcessHubClient();
    if (!c) return NOT_IN_COLLAB;
    return c.contractPublish(input);
  },
});

const collabContractProposeChange = defineTool({
  name: 'collab_contract_propose_change',
  description:
    'Propose a change to a shared contract. The owner and consumers are asked to ack; do NOT change a shared boundary unilaterally.',
  inputSchema: z.object({ id: z.string(), newSpec: z.string().min(1), reason: z.string().min(1) }),
  permission: { action: 'allow' },
  isolation: HUB_RPC_ISOLATION,
  handler: async ({ id, newSpec, reason }) => {
    const c = await getProcessHubClient();
    if (!c) return NOT_IN_COLLAB;
    return c.contractProposeChange(id, newSpec, reason);
  },
});

const collabContractAck = defineTool({
  name: 'collab_contract_ack',
  description: 'Acknowledge a proposed contract change you were asked about. When owner + all consumers ack, the architect commits it.',
  inputSchema: z.object({ id: z.string() }),
  permission: { action: 'allow' },
  isolation: HUB_RPC_ISOLATION,
  handler: async ({ id }) => {
    const c = await getProcessHubClient();
    if (!c) return NOT_IN_COLLAB;
    return c.contractAckChange(id);
  },
});

const collabPeerFiles = defineTool({
  name: 'collab_peer_files',
  description: 'List the files another agent has changed so far (their actual in-progress work).',
  inputSchema: z.object({ agentId: z.string() }),
  permission: { action: 'allow' },
  isolation: HUB_RPC_PEER_ISOLATION,
  handler: async ({ agentId }) => {
    const c = await getProcessHubClient();
    if (!c) return NOT_IN_COLLAB;
    return c.peerFiles(agentId);
  },
});

const collabPeerRead = defineTool({
  name: 'collab_peer_read',
  description: 'Read a file from another agent\'s in-progress work — get their real interface instead of guessing.',
  inputSchema: z.object({ agentId: z.string(), path: z.string() }),
  permission: { action: 'allow' },
  isolation: HUB_RPC_PEER_ISOLATION,
  handler: async ({ agentId, path }) => {
    const c = await getProcessHubClient();
    if (!c) return NOT_IN_COLLAB;
    return c.peerRead(agentId, path);
  },
});

const collabPeerDiff = defineTool({
  name: 'collab_peer_diff',
  description: 'View another agent\'s full diff (vs the shared base) to see exactly what they have built.',
  inputSchema: z.object({ agentId: z.string() }),
  permission: { action: 'allow' },
  isolation: HUB_RPC_PEER_ISOLATION,
  handler: async ({ agentId }) => {
    const c = await getProcessHubClient();
    if (!c) return NOT_IN_COLLAB;
    return c.peerDiff(agentId);
  },
});

/** All peer-side collaboration tools. */
export const collabTools: ReadonlyArray<ToolDef> = [
  collabSend,
  collabBroadcast,
  collabInbox,
  collabRoster,
  collabBoard,
  collabAddTask,
  collabClaim,
  collabRelease,
  collabUpdate,
  collabDone,
  collabContracts,
  collabContractPublish,
  collabContractProposeChange,
  collabContractAck,
  collabPeerFiles,
  collabPeerRead,
  collabPeerDiff,
];

/** Tool names enabled for an implementer peer. */
export const PEER_TOOL_NAMES: ReadonlyArray<string> = collabTools.map((t) => t.name);
