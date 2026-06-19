import type { IpcCommandName } from './commands.js';

/**
 * THE REMOTE / MOBILE TRUST SURFACE — the single source of truth for what a
 * paired phone (or anything else on the LAN holding the bearer token) may invoke
 * over the WebSocket bridge. This is an ALLOW-list, enforced deny-by-default: the
 * WS bus REJECTS any command not listed here with a coded error, regardless of
 * which handlers the host happened to register on the bus.
 *
 * Why an allow-list and not a blocklist: the desktop wires its COMPLETE IPC
 * handler set onto the WS bus (`registerIpcHandlers([electronBus, wsBus], …)`),
 * and the runtime "mobile gateway" binds the LAN wildcard. A blocklist that
 * merely omitted a host-mutating command (toggling auto-approve, creating desks,
 * writing the vault, updating the CLI, …) silently exposed it to a remote client
 * — a privilege-escalation / RCE-adjacent hole. Inverting to allow-by-default-
 * deny means a NEW command is locked out by default; you opt it in here only
 * after deciding a paired phone should be able to drive it.
 *
 * The list is exactly the commands a chat client legitimately needs to hold a
 * conversation: read the session snapshot, send/abort a turn, switch mode, run a
 * slash command, reset the conversation, transcribe voice, ANSWER (not bypass)
 * permission prompts, persist the per-workspace transcript, and list/run/read an
 * EXISTING workflow. Everything else — auto-approve toggling, desk/onboarding/
 * settings/vault/app/prefs writes, workflow AUTHORING (save/validateDraft/
 * setEnabled), native pickers, focus-window control, and the gateway-control
 * commands themselves (`mobileGateway.*`) — stays Electron-bus-only (the trusted
 * local UI) and is refused over the wire.
 *
 * RULE: add a command here ONLY if a paired phone should be able to invoke it.
 * If it mutates host state beyond the conversation, it almost certainly does not
 * belong.
 */
export const REMOTE_ALLOWED_COMMANDS: ReadonlySet<IpcCommandName> = new Set<IpcCommandName>([
  // Answer a permission/approval prompt — RESPOND only. Note that
  // `session.setAutoApprove` (turn the prompt OFF entirely) is deliberately NOT
  // here: a remote client may answer the desktop user's prompts, never disable
  // them and run tools unattended.
  'ask.respond',
  // Workspace discovery + reconnect (read-only / non-mutating).
  'connection.snapshotAll',
  'connection.activeWorkspace',
  'connection.retry',
  // The conversation itself.
  'session.info',
  'session.runTurn',
  'session.abortTurn',
  'session.setMode',
  'session.newSession',
  // ASSUMPTION (breadth-of-surface): this single entry fans out to the ENTIRE
  // registered slash-command set — a paired phone can invoke any command by
  // name (the schema only shape-bounds name+args). The contract can't enumerate
  // which commands are safe, so remote-reachable slash commands MUST be
  // side-effect-free at the conversation level; a mutating command (a /vault-,
  // /mode-, or plugin-provided state mutator) reachable from a phone needs a
  // per-command capability gate at the registry layer (see needsFollowup), not
  // just this allow-list entry.
  'session.runCommand',
  // Multi-session conversations: list/create/switch/rename are conversation-
  // scoped — the same trust class as `session.newSession` (already allowed),
  // and what a paired phone needs to mirror the desktop's session list.
  // `sessions.remove` is deliberately NOT here: it deletes on-disk state
  // (the runner's session JSONL + the chat NDJSON transcript), a destructive
  // host mutation in the same class as `desks.remove`, which is also
  // host-only.
  'sessions.list',
  'sessions.create',
  'sessions.setActive',
  'sessions.rename',
  // Voice input (capability-probed; transcribe fails coded without a transcriber).
  'session.hasTranscriber',
  'session.transcribe',
  // Read a workspace's transcript history from the runner's authoritative log
  // (a paired phone may read history, scoped to a workspace, not host config).
  'chat.loadHistory',
  // Workflows: READ + run an existing one only. Authoring (`workflows.save`,
  // `workflows.validateDraft`, `workflows.setEnabled`) is host-only — a paired
  // phone must not rewrite or re-enable the host's workflows.
  'workflows.list',
  'workflows.run',
  'workflows.getRun',
  // Answer a paused workflow's awaitInput question. This is RESPOND-only — like
  // `ask.respond`, the operator answers a question the WORKFLOW asked (the reply
  // is fed into the paused step and the run continues); it cannot create or
  // rewrite a workflow. A mobile user answering "ship it" to their own pipeline
  // is the canonical human-in-the-loop case, so it belongs on the trust surface.
  'workflows.resume',
]);
