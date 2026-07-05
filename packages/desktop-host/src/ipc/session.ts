/**
 * Per-workspace session commands.
 *
 * Turn lifecycle (runTurn / abortTurn) routes through the workspace's
 * {@link SessionDriver} in the {@link drivers} registry; provider / mode
 * switches and slash commands talk straight to the {@link RemoteSession}
 * (then settle via {@link waitForSessionState}). Voice (hasTranscriber /
 * transcribe) prefers the RUNNER's active transcriber — a runner-side STT
 * plugin (e.g. the local Whisper `@moxxy/plugin-stt-local`) so the desktop
 * mic can transcribe fully offline — and falls back to the in-process Codex
 * transcriber when the runner has none active (byte-identical to the pre-
 * local-STT behavior, mirroring the TUI's self-host setup).
 *
 * Every command accepts an optional `workspaceId` and defaults to the
 * pool's active workspace so the renderer can target a background
 * workspace without foregrounding it.
 */

import { dialog, BrowserWindow as BrowserWindowApi } from 'electron';

import type { RunnerPool } from '../runner-pool';
import { authorizeAttachments, rememberPickedAttachment } from '../attachment-authz';
import { persistImageBlob, previewImageAttachment } from '../attachments.js';
import { broadcastHostEvent } from '../event-bus.js';
import { getSessionModel, setSessionModel } from '../session-models.js';
import {
  getInProcessPlugins,
  handle,
  IpcError,
  mustDriver,
  resolveCtx,
  resolveDriver,
  resolveSupervisor,
  waitForRemoteSession,
  waitForSessionState,
} from './shared';

/** Strict base64 (optional `=` padding). `Buffer.from(x, 'base64')` silently
 *  drops invalid characters and decodes a partial/garbage buffer, so reject a
 *  malformed payload AT the boundary instead of feeding the transcriber junk. */
const BASE64_RE = /^[A-Za-z0-9+/]*={0,2}$/;

// The collaboration on-disk layout (lock path + runs dir) and the defensive
// lock parse/liveness probe are the coordinator's contract, owned by
// `@moxxy/mode-collaborative`'s collab-store. The Collaborate tab reads them
// straight off disk here (no runner round-trip, so a collaboration in ANY
// workspace's runner is visible) — importing the SAME helpers the coordinator
// writes with means the two can't drift apart.

export function registerSessionHandlers(pool: RunnerPool): void {
  // ---- Session (per-workspace) --------------------------------------------

  handle('session.info', async (args) => {
    const session = await waitForRemoteSession(pool, args?.workspaceId);
    return session ? session.getInfo() : null;
  });
  handle('session.runTurn', async ({ workspaceId, prompt, model, attachments, inlineAttachments }) => {
    // requireSession:false — the turn is dispatched through the driver, not the
    // RemoteSession directly, so we only need the id + supervisor (for cwd).
    const { workspaceId: id, supervisor } = resolveCtx(pool, { workspaceId }, { requireSession: false });
    const driver = mustDriver(id);
    // Gate attachment paths on provenance before buildAttachments reads them:
    // only user-picked paths or paths under the workspace cwd are allowed, so
    // a hostile renderer can't inline arbitrary files into the prompt.
    let safe = attachments;
    if (attachments && attachments.length > 0) {
      const cwd = supervisor.getCwd();
      const { authorized, dropped } = await authorizeAttachments(attachments, cwd ? [cwd] : []);
      if (dropped.length > 0) {
        console.warn(
          `[session.runTurn] dropped ${dropped.length} unauthorized attachment(s): ${dropped.join(', ')}`,
        );
      }
      safe = authorized;
    }
    if (model !== undefined) setSessionModel(id, model);
    const selectedModel = model ?? getSessionModel(id) ?? undefined;
    return driver.runTurn(prompt, selectedModel, safe, inlineAttachments);
  });
  handle('session.abortTurn', async ({ workspaceId, turnId }) => {
    // Active-workspace fallback lives in resolveDriver, not inline here.
    resolveDriver(pool, workspaceId)?.abortTurn(turnId);
  });
  handle('session.setProvider', async ({ workspaceId, provider }) => {
    const { workspaceId: id, session, supervisor } = resolveCtx(pool, { workspaceId });
    session.providers.setActive(provider);
    await waitForSessionState(session, (info) => info.activeProvider === provider);
    setSessionModel(id, null, { force: true });
    // Re-emit the connection phase so the renderer sees the new activeProvider
    // — otherwise the onboarding `connectedWithoutProvider` gate never clears.
    supervisor.refreshConnectedInfo();
  });
  handle('session.setModel', async ({ workspaceId, model }) => {
    const { workspaceId: id } = resolveCtx(pool, { workspaceId }, { requireSession: false });
    setSessionModel(id, model, { force: true });
  });
  handle('session.setMode', async ({ workspaceId, mode }) => {
    const { session, supervisor } = resolveCtx(pool, { workspaceId });
    session.modes.setActive(mode);
    await waitForSessionState(session, (info) => info.activeMode === mode);
    supervisor.refreshConnectedInfo();
  });
  handle('session.newSession', async ({ workspaceId }) => {
    // `/new`: reset the runner to a fresh, empty sticky session (the renderer
    // clears its own transcript). resolveSupervisor (not resolveCtx) because a
    // reset deliberately tears the RemoteSession down — requiring a live one
    // would be self-defeating.
    const sup = resolveSupervisor(pool, workspaceId);
    if (sup) await sup.resetSession();
  });
  handle('session.setAutoApprove', async ({ workspaceId, enabled }) => {
    const id = workspaceId ?? pool.activeWorkspaceId();
    if (!id) return;
    // The flag lives on the driver (where the permission resolver is set up),
    // not on the RemoteSession — so target the driver directly.
    mustDriver(id).setAutoApprove(enabled);
    broadcastHostEvent('session.autoApprove.changed', { workspaceId: id, enabled });
  });
  handle('session.runCommand', async ({ workspaceId, name, args }) => {
    const { session } = resolveCtx(pool, { workspaceId });
    const def = session.commands.get(name);
    if (!def) return { kind: 'error', message: `unknown command: /${name}` } as const;
    // The runner doesn't care about the channel name beyond logging,
    // but some command handlers gate behaviour on it. "desktop"
    // mirrors the TUI's "tui" convention and keeps things grep-able.
    const result = await def.handler({
      channel: 'desktop',
      sessionId: session.getInfo().sessionId,
      args,
      // CommandContext.session is `unknown` (the SDK stays core-free); the
      // RemoteSession is assignable directly — no cast needed.
      session,
    });
    return result;
  });
  handle('collab.active', async () => {
    // Read the global single-flight lock the collaborative coordinator writes
    // (~/.moxxy/collab/active.lock). Read directly here (no runner round-trip)
    // so the Collaborate tab sees a collaboration running in ANY workspace.
    try {
      const { readCollabLock, isCollabHolderAlive } = await import('@moxxy/mode-collaborative');
      const info = readCollabLock();
      // A missing/corrupt lock (or one without a usable pid) → not active.
      if (!info) return { active: false };
      // Liveness: a dead holder pid means the lock is stale → not active.
      if (!isCollabHolderAlive(info.pid)) return { active: false };
      return { active: true, sessionId: info.sessionId, task: info.task, startedAtMs: info.startedAtMs };
    } catch {
      return { active: false };
    }
  });
  handle('collab.start', async ({ workspaceId, goal }) => {
    // Start on the DEDICATED coordinator runner — never a chat session. The
    // coordinator works in the target workspace's bound folder. Dynamically
    // imported so the collab/runner stack stays off the Electron boot path.
    const cwd = resolveSupervisor(pool, workspaceId)?.getCwd();
    if (!cwd) throw new IpcError('no-workspace', 'bind a folder before collaborating');
    const { startCollab } = await import('../collab-supervisor');
    return startCollab({ cwd, goal });
  });
  handle('collab.snapshot', async () => {
    // Seed a freshly-mounted panel — and opportunistically attach to a
    // coordinator started elsewhere (e.g. from the TUI) so the desktop can view it.
    const { ensureCollabAttached, collabSnapshot } = await import('../collab-supervisor');
    await ensureCollabAttached().catch(() => undefined);
    return collabSnapshot() as never;
  });
  handle('collab.command', async ({ name, args }) => {
    const { runCollabCommand } = await import('../collab-supervisor');
    return (await runCollabCommand(name, args)) as never;
  });
  handle('collab.respondApproval', async ({ requestId, decision }) => {
    const { respondCollabApproval } = await import('../collab-supervisor');
    respondCollabApproval(requestId, decision);
  });
  handle('collab.end', async () => {
    // Stop the dedicated coordinator (abort its turn — whose finally archives the
    // run — then terminate the process), then force-release the global lock so a
    // new collaboration can start even if a stale/crashed run left it held.
    let abortedTurns = 0;
    try {
      const { stopCollab } = await import('../collab-supervisor');
      abortedTurns = (await stopCollab()).abortedTurns;
    } catch {
      // best-effort
    }
    let clearedTask: string | undefined;
    try {
      // forceReleaseCollabLock removes the lock regardless of holder and returns
      // the cleared holder (if any) so we can report which task we ended — the
      // coordinator's own release-side helper, so the unlink path stays identical.
      const { forceReleaseCollabLock } = await import('@moxxy/mode-collaborative');
      clearedTask = forceReleaseCollabLock()?.task || undefined;
    } catch {
      // best-effort
    }
    return { ended: true, abortedTurns, ...(clearedTask ? { clearedTask } : {}) };
  });
  handle('collab.history', async (args) => {
    // Read archived run records straight from ~/.moxxy/collab/runs (self-
    // describing JSON), newest first — no runner round-trip, spans all workspaces.
    //
    // Hardening: the runs dir grows without bound (one file per collaboration),
    // and the renderer's `limit` is untrusted. Reading + parsing every file
    // SYNCHRONOUSLY on the Electron main event loop (the old impl) blocks all
    // other IPC/animation/input. So: (1) all I/O is async (fs/promises +
    // Promise.all), (2) `limit` is clamped, and (3) we never read more than a
    // hard ceiling of files — the newest by mtime (a write-time proxy for run
    // finish), then sort the parsed records by their authoritative `startedAtMs`.
    try {
      const { readdir, readFile, stat } = await import('node:fs/promises');
      const { join } = await import('node:path');
      // The runs dir layout is the coordinator's contract (`collabRunsDir`); the
      // ASYNC, mtime-bounded scan below stays desktop-side on purpose — the
      // coordinator's sync `listRunRecords` would block the Electron main event
      // loop reading every file, which this handler header explicitly avoids.
      const { collabRunsDir } = await import('@moxxy/mode-collaborative');
      const dir = collabRunsDir();
      // Clamp the renderer-supplied limit to a sane window (default 50, max 200);
      // a non-positive / non-finite value falls back to the default.
      const requested = Number(args?.limit ?? 50);
      const limit = Number.isFinite(requested) && requested > 0 ? Math.min(Math.floor(requested), 200) : 50;
      // Read at most this many files regardless of how large the dir grows — the
      // newest by mtime. (mtime ordering tracks run-finish ordering, so the
      // top-N by startedAtMs are within this window.)
      const MAX_SCAN = 200;
      const names = (await readdir(dir)).filter((f) => f.endsWith('.json'));
      const withMtime = await Promise.all(
        names.map(async (f) => {
          try {
            const s = await stat(join(dir, f));
            return { f, mtimeMs: s.mtimeMs };
          } catch {
            return null;
          }
        }),
      );
      const newest = withMtime
        .filter((e): e is { f: string; mtimeMs: number } => e !== null)
        .sort((a, b) => b.mtimeMs - a.mtimeMs)
        .slice(0, MAX_SCAN);
      const parsed = await Promise.all(
        newest.map(async ({ f }) => {
          try {
            return JSON.parse(await readFile(join(dir, f), 'utf8')) as { startedAtMs?: number };
          } catch {
            return null;
          }
        }),
      );
      const records = parsed
        .filter((r): r is { startedAtMs?: number } => r !== null)
        .sort((a, b) => (b.startedAtMs ?? 0) - (a.startedAtMs ?? 0))
        .slice(0, limit);
      return records as never;
    } catch {
      return [];
    }
  });
  handle('session.hasTranscriber', async () => {
    // The mic affordance lights up when EITHER voice path can serve a
    // transcribe:
    //   1. the RUNNER has an active transcriber (a runner-side STT plugin such
    //      as the local Whisper `@moxxy/plugin-stt-local`, adopted via the
    //      `plugins.transcriber.default` config) — read straight off the
    //      RemoteSession's info snapshot, no extra RPC; or
    //   2. stored Codex OAuth creds exist for the in-process fallback path.
    // Checking `activeTranscriber` (not the "any registered" `hasTranscriber`
    // flag) keeps this in lockstep with `session.transcribe` below, which
    // routes through `transcribers.tryGetActive()` — also keyed on the ACTIVE
    // transcriber.
    const remote = resolveSupervisor(pool)?.remote();
    if (remote?.getInfo().activeTranscriber) return true;
    try {
      const { vault } = getInProcessPlugins();
      // Stored Codex creds are written under `oauth/openai-codex/...`
      // by `moxxy login openai-codex`. We check the canonical
      // refresh-token key; the transcriber's own resolver does the
      // detailed validation when transcribe() is called.
      const refresh = await vault.get('oauth/openai-codex/refresh_token');
      return refresh != null;
    } catch {
      return false;
    }
  });
  handle('session.transcribe', async ({ workspaceId, audioBase64, mimeType }) => {
    if (typeof audioBase64 !== 'string' || !BASE64_RE.test(audioBase64)) {
      throw new IpcError('invalid-payload', 'audioBase64 is not valid base64');
    }
    const audio = Buffer.from(audioBase64, 'base64');
    const opts = mimeType ? { mimeType } : undefined;
    // Prefer the RUNNER's active transcriber (like `session.synthesize` routes
    // TTS): a runner-side STT plugin (e.g. the local Whisper transcriber) lets
    // the desktop mic transcribe fully offline. `tryGetActive()` returns the
    // proxy when the runner reports an active transcriber, else null.
    const runnerTranscriber = resolveSupervisor(pool, workspaceId)
      ?.remote()
      ?.transcribers.tryGetActive();
    if (runnerTranscriber) {
      // A PRESENT-but-failing runner transcriber (a broken local model) surfaces
      // its error to the user — we deliberately do NOT silently fall back to the
      // cloud Codex path here, which would mask the breakage. Only the "no
      // active transcriber" case (tryGetActive() === null, handled below) falls
      // back.
      const result = await runnerTranscriber.transcribe(new Uint8Array(audio), opts);
      return result.text;
    }
    // No active runner transcriber → in-process Codex transcriber: same plugin
    // class, same vault, identical to the TUI's self-host voice path. This is
    // byte-identical to the behavior before local-STT routing.
    const { transcriber } = getInProcessPlugins();
    const result = await transcriber.transcribe(audio, opts);
    return result.text;
  });
  handle('session.synthesize', async ({ workspaceId, text }) => {
    // Text-to-speech routes through the RUNNER's active synthesizer (unlike
    // STT, which uses the in-process Codex transcriber): a user-authored TTS
    // plugin (e.g. ElevenLabs) lives in ~/.moxxy/plugins, loaded by the runner.
    // Returns null when no synthesizer is active so the renderer falls back to
    // the OS `speechSynthesis` voice.
    const session = resolveSupervisor(pool, workspaceId)?.remote();
    const synth = session?.synthesizers.tryGetActive();
    if (!synth) return null;
    const result = await synth.synthesize(text);
    return {
      audioBase64: Buffer.from(result.audio).toString('base64'),
      mimeType: result.mimeType,
    };
  });
  handle('session.pickAttachment', async () => {
    const window =
      BrowserWindowApi.getFocusedWindow() ?? BrowserWindowApi.getAllWindows()[0];
    const opts: Electron.OpenDialogOptions = {
      title: 'Attach a file to the next prompt',
      properties: ['openFile'],
      // Steer the picker toward what the agent can actually use: documents,
      // images, and text/code. buildAttachments is the real gate (it reads the
      // bytes and routes / drops as needed), but the filter keeps the user from
      // picking a 4 GB video.
      filters: [
        {
          name: 'Attachable files',
          extensions: [
            'pdf', 'docx', 'xlsx', 'pptx', 'odt', 'ods', 'odp',
            'png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp',
            'txt', 'md', 'markdown', 'json', 'yaml', 'yml', 'csv', 'tsv', 'log', 'sql',
            'js', 'jsx', 'ts', 'tsx', 'py', 'rb', 'go', 'rs', 'java', 'kt', 'c', 'h',
            'cpp', 'hpp', 'cs', 'php', 'sh', 'bash', 'zsh', 'html', 'css', 'scss',
            'xml', 'toml', 'ini', 'env', 'conf',
          ],
        },
        { name: 'Documents', extensions: ['pdf', 'docx', 'xlsx', 'pptx', 'odt', 'ods', 'odp'] },
        { name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp'] },
        { name: 'All files', extensions: ['*'] },
      ],
    };
    // Use the honest parentless overload when no window exists rather than
    // coercing an intentionally-null value with `null!`.
    const result = window
      ? await dialog.showOpenDialog(window, opts)
      : await dialog.showOpenDialog(opts);
    if (result.canceled || result.filePaths.length === 0) return null;
    const picked = result.filePaths[0]!;
    // Remember the user's choice so the later runTurn that references it is
    // authorized even though it lives outside the workspace cwd.
    await rememberPickedAttachment(picked);
    return picked;
  });
  handle('session.saveImageAttachment', async ({ dataBase64, mediaType, name }) => {
    // The renderer can't write files, so a pasted/dropped/captured image's
    // bytes are stashed to a temp file here; the returned path then rides the
    // same attachment pipeline as a picked file.
    const saved = await persistImageBlob(dataBase64, mediaType, name);
    // Remember the temp path so the later runTurn that references it clears the
    // provenance gate. The file lives under os.tmpdir() — not the workspace cwd
    // — and was never handed out by the picker, so without this
    // authorizeAttachments drops it and the prompt is sent with NO image
    // (clipboard paste, drag-drop, AND browser-capture screenshots all land
    // here). Mirrors session.pickAttachment, which remembers its picked path.
    await rememberPickedAttachment(saved.path);
    return saved;
  });
  handle('session.previewAttachment', async ({ workspaceId, path, name }) => {
    const { supervisor } = resolveCtx(pool, { workspaceId }, { requireSession: false });
    const cwd = supervisor.getCwd();
    const { authorized } = await authorizeAttachments(
      [{ path, name }],
      cwd ? [cwd] : [],
    );
    const [att] = authorized;
    if (!att) return null;
    return previewImageAttachment(att.path, att.name);
  });
}
