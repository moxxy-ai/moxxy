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
import type { UserPromptAttachment } from '@moxxy/sdk';
import type { IpcCommandName } from './index.js';

/** Single source of truth for the runtime attachment-kind enum. It is tied to
 *  the SDK's `UserPromptAttachment.kind` union by the assertion below, so if the
 *  SDK adds/removes a kind this stops compiling instead of silently drifting
 *  (the Zod enum would otherwise reject legit payloads with no typecheck link). */
const USER_PROMPT_ATTACHMENT_KINDS = ['stdin', 'file', 'image', 'document', 'audio'] as const;
// Compile-time bidirectional check: the tuple's members exactly cover the union.
type _AttachmentKindsCover = UserPromptAttachment['kind'] extends
  (typeof USER_PROMPT_ATTACHMENT_KINDS)[number]
  ? (typeof USER_PROMPT_ATTACHMENT_KINDS)[number] extends UserPromptAttachment['kind']
    ? true
    : never
  : never;
const _attachmentKindsCover: _AttachmentKindsCover = true;

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
      const u = new URL(s);
      if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
      // Reject embedded credentials: `https://accounts.google.com@evil/...`
      // opened in the default browser is a phishing primitive, and the validator
      // is the documented choke point in front of shell.openExternal.
      return u.username === '' && u.password === '';
    } catch {
      return false;
    }
  }, 'must be an http(s) URL without embedded credentials');

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
/** Aggregate ceiling across ALL inline-attachment entries on one runTurn so the
 *  per-entry cap × 8 entries can't sum to ~96 MB of base64 (~72 MB decoded) that
 *  the host must buffer + decode at once. Bounds the single-call blast radius;
 *  the per-CONNECTION budget across N concurrent bearer-holding peers is a
 *  cross-package gateway concern (see deferred). 24 MB ≈ ~18 MB decoded — two
 *  full 9 MB picks, which is the practical mobile ceiling. */
const MAX_INLINE_ATTACHMENTS_TOTAL = 24_000_000;
/** Strict base64 shape (optional `=` padding). Shared between the transcribe
 *  guard and the inline-attachment guard so a non-base64 string never reaches a
 *  `Buffer.from(x,'base64')` / provider decoder, which silently drops invalid
 *  chars and decodes a partial/garbage buffer. Empty matches (the size bound,
 *  not emptiness, is the host guard). */
const BASE64_RE = /^[A-Za-z0-9+/]*={0,2}$/;
/** Strict base64 (optional `=` padding) — MUST match the transcribe handler's
 *  own `BASE64_RE` (packages/desktop-host/src/ipc/session.ts) so the contract
 *  rejects the same malformed payload one hop EARLIER. Empty is allowed (the
 *  size bound, not emptiness, is what guards the host here). */
const base64 = z.string().max(MAX_AUDIO_BASE64).regex(BASE64_RE, 'must be base64');

/** Inline-attachment kinds whose `content` is base64-encoded BYTES (vs. the
 *  text kinds `stdin`/`file`, which carry inline UTF-8). For these the renderer-
 *  /remote-supplied `content` is decoded host-side (mobile path) or handed to a
 *  provider as image/document/audio data (`project-messages.ts`), so a malformed
 *  base64 string would decode to garbage — reject it at the boundary, one hop
 *  before any decoder, exactly as `session.transcribe` does for `audioBase64`. */
const BASE64_ATTACHMENT_KINDS: ReadonlySet<UserPromptAttachment['kind']> = new Set([
  'image',
  'document',
  'audio',
]);

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

/** Channel id == the CLI subcommand spawned as `moxxy <channelId>`, so pin it to
 *  a non-traversing, non-flag slug: lowercase letters/digits/hyphen only. */
const channelId = z.string().min(1).max(64).regex(/^[a-z][a-z0-9-]*$/, 'invalid channel id');

/** Workflow names come from workflow filenames — bounded, no traversal. */
const workflowName = z
  .string()
  .min(1)
  .max(200)
  .refine((s) => !s.includes('..') && !s.includes('/') && !s.includes('\\'), 'invalid workflow name');

const scheduleId = z.string().min(1).max(256);
const webhookId = z.string().min(1).max(256);
/** A target session id (same shape as a session/desk id), or null to clear it. */
const sessionRef = z.string().min(1).max(256).nullable();
const focusDelta = z.number().finite().min(-10_000).max(10_000);
const focusScreenPoint = z.number().finite().min(-100_000).max(100_000);
const focusSize = z.number().finite().int().min(40).max(800);

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
  'focus.toggle': z.undefined(),
  'focus.moveBy': z.object({ dx: focusDelta, dy: focusDelta }).strict(),
  'focus.dragStart': z.object({ screenX: focusScreenPoint, screenY: focusScreenPoint }).strict(),
  'focus.dragMove': z.object({ screenX: focusScreenPoint, screenY: focusScreenPoint }).strict(),
  'focus.dragEnd': z.undefined(),
  'focus.resize': z
    .object({
      width: focusSize,
      height: focusSize,
      resizable: z.boolean().optional(),
    })
    .strict(),
  'onboarding.openExternal': z.object({ url: httpUrl }),
  'onboarding.saveProviderKey': z.object({
    provider: providerName,
    secret: z.string().min(1).max(8192),
  }),
  'onboarding.providerAuthKind': z.object({ provider: providerName }),
  'onboarding.provisionProvider': z.object({
    provider: providerName,
    model: z.string().min(1).max(256).optional(),
  }),
  // Interactive provider sign-in spawns `moxxy login <provider>` and feeds it
  // the user's pasted answers over stdin — guard the provider slug and the
  // correlation id, and bound the answer (a token / `code#state`) so a hostile
  // renderer can't OOM the host or smuggle a flag.
  'provider.login.start': z.object({ loginId, provider: providerName }),
  'provider.login.answer': z.object({ loginId, value: z.string().max(8192) }),
  'provider.login.cancel': z.object({ loginId }),
  'session.transcribe': z.object({
    audioBase64: base64,
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
  'session.setModel': z.object({
    workspaceId: optionalWorkspace,
    model: z.string().min(1).max(256).nullable(),
  }),
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
    // bound the entry count, the per-entry content size, AND (below) the sum of
    // all entries so 8 × the per-entry cap can't force ~72 MB of transient decode.
    inlineAttachments: z
      .array(
        z.object({
          kind: z.enum(USER_PROMPT_ATTACHMENT_KINDS),
          content: z.string().max(MAX_INLINE_ATTACHMENT_CONTENT),
          name: z.string().max(1024).optional(),
          mediaType: z.string().max(128).optional(),
        }),
      )
      .max(8)
      .superRefine((entries, ctx) => {
        let total = 0;
        for (let i = 0; i < entries.length; i++) {
          const e = entries[i]!;
          // Binary kinds (image/document/audio) carry base64 bytes that get
          // decoded host-side / by the provider — a non-base64 string would
          // decode to garbage, so reject it here (text kinds carry UTF-8 and
          // are intentionally unconstrained beyond the size cap).
          if (BASE64_ATTACHMENT_KINDS.has(e.kind) && !BASE64_RE.test(e.content)) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: [i, 'content'],
              message: `inline ${e.kind} attachment content must be base64`,
            });
          }
          total += e.content.length;
          if (total > MAX_INLINE_ATTACHMENTS_TOTAL) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: `inline attachments exceed the ${MAX_INLINE_ATTACHMENTS_TOTAL}-char aggregate cap`,
            });
            return;
          }
        }
      })
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
  // Reassign a trigger's target session. `sessionId` is a session id (same shape
  // as the scheduler/webhook ids) or null to clear the binding.
  'workflows.setTargetSession': z.object({ name: workflowName, sessionId: sessionRef }),
  'scheduler.list': z.undefined(),
  'scheduler.setEnabled': z.object({ id: scheduleId, enabled: z.boolean() }),
  'scheduler.setTargetSession': z.object({ id: scheduleId, sessionId: sessionRef }),
  'scheduler.delete': z.object({ id: scheduleId }),
  // Webhooks: host-only management of inbound triggers. Lock the id like the
  // scheduler entries; list takes no args.
  'webhooks.list': z.undefined(),
  'webhooks.setEnabled': z.object({ id: webhookId, enabled: z.boolean() }),
  'webhooks.setTargetSession': z.object({ id: webhookId, sessionId: sessionRef }),
  'webhooks.delete': z.object({ id: webhookId }),
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
  // Git (Files-changed pane + diff viewer) shells out to `git` with the
  // renderer-supplied workspaceId, and git.diff additionally with a renderer
  // path that reaches `git diff --no-index -- <devNull> <path>` for untracked
  // files. They touch a child process + the filesystem, so they get the same
  // boundary check as the sibling workspace.* commands (the cwd-scoping authz
  // lives handler-side; this caps the shape so a hostile renderer can't OOM/
  // smuggle an oversized argument across).
  'git.isRepo': z.object({ workspaceId: z.string().min(1).max(256) }),
  'git.status': z.object({ workspaceId: z.string().min(1).max(256) }),
  'git.diff': z.object({
    workspaceId: z.string().min(1).max(256),
    path: z.string().min(1).max(4096),
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
  // Channels: channelId is spawned as `moxxy <channelId>`, so pin it to a
  // non-traversing slug. saveConfig carries secrets — bound the field count +
  // each value's length so a hostile renderer can't OOM the host / bloat the
  // vault (the keys are bounded field ids; values are tokens).
  'channels.list': z.undefined(),
  'channels.saveConfig': z.object({
    channelId,
    values: z.record(z.string().min(1).max(64), z.string().max(8192)),
  }),
  'channels.start': z.object({ channelId }),
  'channels.stop': z.object({ channelId }),
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
  'desks.list': z.undefined(),
  'desks.create': z.object({ name: z.string().min(1).max(200), cwd: z.string().min(1).max(4096) }),
  // Mirror desks.create's name bounds — rename writes the name into the desks
  // JSON, so an unbounded string would let a renderer bloat the state file.
  'desks.rename': z.object({
    id: z.string().min(1).max(256),
    name: z.string().min(1).max(200),
  }),
  'desks.setActive': z.object({ id: z.string().min(1).max(256) }),
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
  // `before` is a runner `seq` cursor; the page is RAW events. The runner itself
  // re-validates and caps at its own MAX_HISTORY_PAGE_LIMIT (2000), so bound the
  // renderer's raw-window request to that ceiling.
  'chat.loadHistory': z.object({
    workspaceId: z.string().min(1).max(256),
    before: z.number().int().nonnegative().nullable(),
    limit: z.number().int().positive().max(2000),
  }),
  // Collaboration control. All three touch the on-disk collab store
  // (~/.moxxy/collab/{active.lock,runs}) — a filesystem-touching surface — so
  // each gets the boundary check the module header promises:
  //   - active: no-arg → pin the payload to "nothing" so no args smuggle across;
  //   - history: a positive, bounded page size (matching the handler's 200
  //     ceiling) so a hostile renderer can't push a non-integer/NaN/huge window;
  //   - end: an optional, bounded workspace slug (the target runner to abort).
  'collab.active': z.undefined(),
  'collab.history': z.object({ limit: z.number().int().positive().max(200) }).partial().optional(),
  'collab.end': z.object({ workspaceId: optionalWorkspace }).optional(),
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
