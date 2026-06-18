/**
 * Runtime validation for the IPC boundary. Compile-time types don't
 * protect the main process from a compromised/XSS'd renderer, so the
 * security-sensitive handlers (anything that touches the filesystem, a
 * child process, the vault, or `shell.openExternal`) get a Zod schema
 * checked before the handler body runs.
 *
 * Only the dangerous commands are listed — no-arg or
 * already-defended-in-depth commands are intentionally absent.
 */

import { z } from 'zod';
import type { IpcCommandName } from './index.js';

/** Mirror of the main-process provider-name guard: a strict slug so a
 *  provider name can't inject a CLI flag or traverse the vault keyspace. */
const providerName = z.string().regex(/^[a-z][a-z0-9-]{0,63}$/, 'invalid provider name');

/** Renderer-supplied correlation id for an interactive login (a UUID). A plain
 *  token so it can't smuggle a path or shell text into the host's run map. */
const loginId = z.string().min(1).max(64).regex(/^[A-Za-z0-9-]+$/, 'invalid login id');

const httpUrl = z
  .string()
  .refine((s) => {
    try {
      const p = new URL(s).protocol;
      return p === 'http:' || p === 'https:';
    } catch {
      return false;
    }
  }, 'must be an http(s) URL');

/** Skill names map to files under ~/.moxxy/skills — forbid traversal and
 *  absolute paths, allow nested folders. */
const skillName = z
  .string()
  .min(1)
  .max(200)
  .regex(/^[A-Za-z0-9][A-Za-z0-9 ._/-]*$/, 'invalid skill name')
  .refine((s) => !s.includes('..'), 'skill name may not contain ".."');

/** Vault key — letters/digits then letters/digits/dot/underscore/slash/hyphen
 *  (slashes allow namespaced keys like `oauth/openai-codex/refresh_token`),
 *  no `..` traversal. */
const vaultKeyName = z
  .string()
  .min(1)
  .max(200)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._/-]*$/, 'invalid vault key name')
  .refine((s) => !s.includes('..'), 'vault key name may not contain ".."');

const optionalWorkspace = z.string().min(1).max(256).optional();
/** ~30 MB of base64 — generous for a voice clip, bounded so a renderer
 *  can't OOM the main process with one transcribe call. */
const MAX_AUDIO_BASE64 = 40_000_000;
/** ~9 MB of payload per inline attachment (the mobile app caps picks at 8 MB
 *  raw; base64 inflates ×4/3). Bounded so a hostile client can't OOM the host. */
const MAX_INLINE_ATTACHMENT_CONTENT = 12_000_000;

/** Slash-command name — a registry slug, never a path or shell text. */
const commandName = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/, 'invalid command name');

/** Desktop-app id — a registry slug keying both the renderer app registry and
 *  the main installer/asset directory (`userData/moxxy-apps/<appId>`), so it
 *  must never traverse: lowercase letters/digits/hyphen only. */
const appId = z.string().min(1).max(64).regex(/^[a-z][a-z0-9-]*$/, 'invalid app id');

/** Workflow names come from workflow filenames — bounded, no traversal. */
const workflowName = z
  .string()
  .min(1)
  .max(200)
  .refine((s) => !s.includes('..') && !s.includes('/') && !s.includes('\\'), 'invalid workflow name');

export const ipcInputSchemas: Partial<Record<IpcCommandName, z.ZodTypeAny>> = {
  // No-arg, but spawns a child process (npm install) — pin the payload to
  // "nothing" so a hostile renderer can't smuggle args across.
  'app.cliInfo': z.undefined(),
  'app.updateCli': z.undefined(),
  // Self-update: all no-arg. The update SOURCE (manifest/bundle URL) is resolved
  // main-side only — a hostile renderer must never be able to point the loader
  // at an attacker URL, so these accept nothing.
  'app.updateInfo': z.undefined(),
  'app.checkUpdate': z.undefined(),
  'app.updateDashboard': z.undefined(),
  'app.updateShell': z.undefined(),
  'app.relaunch': z.undefined(),
  'app.appBooted': z.undefined(),
  'app.updateDiagnostics': z.undefined(),
  // Renderer-reported confirm failure — bound the message so a hostile renderer
  // can't bloat the on-disk boot-log.
  'app.bootHeartbeatFailed': z.object({ error: z.string().max(2048) }),
  'onboarding.openExternal': z.object({ url: httpUrl }),
  'onboarding.saveProviderKey': z.object({
    provider: providerName,
    secret: z.string().min(1).max(8192),
  }),
  'onboarding.providerAuthKind': z.object({ provider: providerName }),
  // Interactive provider sign-in spawns `moxxy login <provider>` and feeds it
  // the user's pasted answers over stdin — guard the provider slug and the
  // correlation id, and bound the answer (a token / `code#state`) so a hostile
  // renderer can't OOM the host or smuggle a flag.
  'provider.login.start': z.object({ loginId, provider: providerName }),
  'provider.login.answer': z.object({ loginId, value: z.string().max(8192) }),
  'provider.login.cancel': z.object({ loginId }),
  'session.transcribe': z.object({
    audioBase64: z.string().max(MAX_AUDIO_BASE64),
    mimeType: z.string().max(128).optional(),
  }),
  // Read-only snapshots and the abort RPC are reachable over the remote (WS)
  // bridge — they carry free-form ids/workspaceId, so bound them like the
  // sibling validated commands so a hostile remote can't OOM/log-bloat the host
  // with an oversized string. All currently-valid payloads (a short turn id, an
  // optional workspace slug, an optional desk id, or no arg at all) still pass.
  'session.info': z.object({ workspaceId: optionalWorkspace }).optional(),
  'session.abortTurn': z.object({
    workspaceId: optionalWorkspace,
    turnId: z.string().min(1).max(256),
  }),
  'sessions.list': z.object({ deskId: z.string().min(1).max(256).optional() }).optional(),
  'session.setProvider': z.object({ workspaceId: optionalWorkspace, provider: providerName }),
  'session.setMode': z.object({ workspaceId: optionalWorkspace, mode: z.string().min(1).max(64) }),
  'session.newSession': z.object({ workspaceId: optionalWorkspace }),
  // A turn's prompt + optional attachments cross from the renderer into the
  // model. Bound the shape so a hostile renderer can't OOM the main process
  // with a giant prompt or a flood of attachment entries. The attachment
  // PATHS themselves are authorized separately (a path must be user-picked or
  // live under the workspace cwd) — see `attachment-authz.ts` — because shape
  // validation alone can't tell a legit absolute path from an injected one.
  'session.runTurn': z.object({
    workspaceId: optionalWorkspace,
    prompt: z.string().max(1_000_000),
    model: z.string().min(1).max(256).optional(),
    attachments: z
      .array(
        z.object({
          path: z.string().min(1).max(4096),
          name: z.string().min(1).max(1024),
        }),
      )
      .max(64)
      .optional(),
    // Inline attachments cross the wire as payload (remote/mobile clients) —
    // bound both the entry count and per-entry content size.
    inlineAttachments: z
      .array(
        z.object({
          kind: z.enum(['stdin', 'file', 'image', 'document', 'audio']),
          content: z.string().max(MAX_INLINE_ATTACHMENT_CONTENT),
          name: z.string().max(1024).optional(),
          mediaType: z.string().max(128).optional(),
        }),
      )
      .max(8)
      .optional(),
  }),
  // Runs an arbitrary registered slash command — the audit flagged this as the
  // one mutating session command without a schema, so lock the name to a
  // registry slug and bound the free-text args.
  'session.runCommand': z.object({
    workspaceId: optionalWorkspace,
    name: commandName,
    args: z.string().max(10_000),
  }),
  'workflows.run': z.object({ name: workflowName }),
  'workflows.setEnabled': z.object({ name: workflowName, enabled: z.boolean() }),
  // Builder commands. validateDraft/save take full YAML — bound the size so a
  // hostile renderer can't OOM the host; save writes to disk so it's
  // filesystem-touching and gets a boundary check like the other writers.
  'workflows.validateDraft': z.object({ yaml: z.string().min(1).max(1_000_000) }),
  'workflows.save': z.object({
    yaml: z.string().min(1).max(1_000_000),
    previousName: workflowName.optional(),
  }),
  'workflows.getRun': z.object({ name: workflowName }),
  // Human-in-the-loop resume: bound the run id + the operator reply (the reply
  // is forwarded into the paused step's child agent, so cap it to avoid OOM).
  'workflows.resume': z.object({
    runId: z.string().min(1).max(120),
    reply: z.string().min(1).max(100_000),
  }),
  // Security-sensitive: this bypasses the approval sheet, so validate it at
  // the boundary like the other dangerous commands.
  'session.setAutoApprove': z.object({ workspaceId: optionalWorkspace, enabled: z.boolean() }),
  'workspace.listDir': z.object({
    workspaceId: z.string().min(1).max(256),
    path: z.string().max(4096).optional(),
  }),
  'workspace.readFile': z.object({
    workspaceId: z.string().min(1).max(256),
    path: z.string().min(1).max(4096),
    force: z.boolean().optional(),
  }),
  'settings.fetchProviderModels': z.object({ provider: providerName }),
  // Session config mutation — pin the effort to the known enum so a renderer
  // can't push an arbitrary string through to the runner / provider request.
  'settings.setReasoning': z.object({
    workspaceId: optionalWorkspace,
    effort: z.enum(['off', 'low', 'medium', 'high']),
  }),
  'settings.writeSkill': z.object({ name: skillName, body: z.string().max(1_000_000) }),
  'settings.readSkill': z.object({ name: skillName }),
  'settings.deleteSkill': z.object({ name: skillName }),
  // Desktop apps: appId keys the per-app install dir + a network download, so
  // pin it to a non-traversing slug. (pickDocument is no-arg → see below.)
  'apps.status': z.object({ appId }),
  'apps.install': z.object({ appId }),
  'apps.uninstall': z.object({ appId }),
  // Anonymizer: parseDocument reads a file (bound the path), saveRedacted writes
  // one (bound name + cap content so a renderer can't OOM main). pickDocument
  // takes nothing — pin it to "nothing" so no args can be smuggled across.
  'anonymizer.pickDocument': z.undefined(),
  'anonymizer.parseDocument': z.object({ path: z.string().min(1).max(4096) }),
  // A drag-dropped doc: the renderer sends the dropped file's BYTES (base64),
  // not a path — so there's no arbitrary-file-read to gate, only a size to cap.
  // ~67 MB of base64 ≈ 50 MB of file, matching the picker's practical ceiling.
  'anonymizer.parseDocumentBytes': z.object({
    name: z.string().min(1).max(255),
    dataBase64: z.string().min(1).max(67_000_000),
  }),
  'anonymizer.saveRedacted': z.object({
    suggestedName: z.string().min(1).max(255),
    content: z.string().max(20_000_000),
  }),
  'desks.create': z.object({ name: z.string().min(1).max(200), cwd: z.string().min(1).max(4096) }),
  // Mirror desks.create's name bounds — rename writes the name into the desks
  // JSON, so an unbounded string would let a renderer bloat the state file.
  'desks.rename': z.object({
    id: z.string().min(1).max(256),
    name: z.string().min(1).max(200),
  }),
  // Sessions: create/rename persist the name into the desks JSON (bound it
  // like desks.create/rename); setActive spawns a runner and remove deletes
  // the session's on-disk logs, so their ids are bounded too. These commands
  // are also served to remote (WS) clients, so the bounds are load-bearing.
  'sessions.create': z
    .object({
      deskId: z.string().min(1).max(256).optional(),
      name: z.string().min(1).max(200).optional(),
    })
    .optional(),
  'sessions.setActive': z.object({ id: z.string().min(1).max(256) }),
  'sessions.remove': z.object({ id: z.string().min(1).max(256) }),
  'sessions.rename': z.object({
    id: z.string().min(1).max(256),
    name: z.string().min(1).max(200),
  }),
  // Whitelist the fields a renderer may write — `version` is managed by
  // the main process; unknown keys are rejected (.strict()).
  'prefs.update': z
    .object({
      onboardingComplete: z.boolean().optional(),
      clerkUserId: z.string().max(256).nullable().optional(),
      clerkDisplayName: z.string().max(256).nullable().optional(),
      signedInAt: z.number().nullable().optional(),
      mobileGatewayEnabled: z.boolean().optional(),
      theme: z.enum(['light', 'dark', 'system']).optional(),
    })
    .strict(),
  // Mobile-gateway control. Both no-arg variants pin the payload to "nothing"
  // so a hostile caller can't smuggle args; setEnabled is a strict boolean.
  'mobileGateway.status': z.undefined(),
  'mobileGateway.rotateToken': z.undefined(),
  'mobileGateway.setEnabled': z.object({ enabled: z.boolean() }).strict(),
  'chat.append': z.object({
    workspaceId: z.string().min(1).max(256),
    events: z.array(z.unknown()).max(10_000),
  }),
  'chat.loadSegment': z.object({
    workspaceId: z.string().min(1).max(256),
    before: z.number().int().nonnegative().nullable(),
    limit: z.number().int().positive().max(1000),
  }),
  // Same shape as chat.loadSegment, but `before` is a runner `seq` cursor and
  // the page is RAW events; the runner itself re-validates and caps at its own
  // MAX_HISTORY_PAGE_LIMIT (2000), so bound the renderer's raw-window request to
  // that ceiling.
  'chat.loadHistory': z.object({
    workspaceId: z.string().min(1).max(256),
    before: z.number().int().nonnegative().nullable(),
    limit: z.number().int().positive().max(2000),
  }),
  'chat.clearLog': z.object({ workspaceId: z.string().min(1).max(256) }),
  // chat.migrate writes the supplied events straight into per-workspace NDJSON
  // logs on disk, so it's a filesystem-touching command: bound both the number
  // of workspaces and the events per workspace, and lock the workspaceId to a
  // non-empty bounded slug so it can't traverse out of the log directory.
  'chat.migrate': z.object({
    workspaces: z
      .array(
        z.object({
          workspaceId: z.string().min(1).max(256),
          events: z.array(z.unknown()).max(10_000),
        }),
      )
      .max(100),
  }),
  // Vault writes are security-sensitive: lock the key name to a safe slug
  // (letters/digits + . _ / - , no traversal) and bound the secret size.
  'settings.vaultSet': z.object({
    name: vaultKeyName,
    value: z.string().min(1).max(32_768),
  }),
  'settings.vaultDelete': z.object({ name: vaultKeyName }),
  // Permission/approval reply — security-sensitive (it decides a tool call),
  // so the shape is locked down: a known requestId + a strict response.
  'ask.respond': z
    .object({
      requestId: z.string().min(1).max(128),
      response: z
        .object({
          mode: z.enum(['allow', 'allow_session', 'allow_always', 'deny']).optional(),
          optionId: z.string().max(128).optional(),
          text: z.string().max(10_000).optional(),
        })
        .strict(),
    })
    .strict(),
};

/**
 * Validate a command's first argument against its schema (if any).
 * Throws on mismatch so the handler never runs with hostile input.
 */
export function validateIpcInput(command: IpcCommandName, arg: unknown): void {
  const schema = ipcInputSchemas[command];
  if (!schema) return;
  const result = schema.safeParse(arg);
  if (!result.success) {
    const detail = result.error.issues.map((i) => `${i.path.join('.') || '·'}: ${i.message}`).join('; ');
    throw new Error(`invalid IPC payload for "${command}": ${detail}`);
  }
}
