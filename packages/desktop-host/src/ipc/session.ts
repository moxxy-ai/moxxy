/**
 * Per-workspace session commands.
 *
 * Turn lifecycle (runTurn / abortTurn) routes through the workspace's
 * {@link SessionDriver} in the {@link drivers} registry; provider / mode
 * switches and slash commands talk straight to the {@link RemoteSession}
 * (then settle via {@link waitForSessionState}). Voice (hasTranscriber /
 * transcribe) is served by the in-process Codex transcriber rather than
 * a runner round-trip, mirroring the TUI's self-host setup.
 *
 * Every command accepts an optional `workspaceId` and defaults to the
 * pool's active workspace so the renderer can target a background
 * workspace without foregrounding it.
 */

import { dialog, BrowserWindow as BrowserWindowApi } from 'electron';

import type { RunnerPool } from '../runner-pool';
import { authorizeAttachments, rememberPickedAttachment } from '../attachment-authz';
import { persistImageBlob } from '../attachments.js';
import {
  getInProcessPlugins,
  handle,
  IpcError,
  mustDriver,
  resolveCtx,
  resolveDriver,
  resolveSupervisor,
  waitForSessionState,
} from './shared';

/** Strict base64 (optional `=` padding). `Buffer.from(x, 'base64')` silently
 *  drops invalid characters and decodes a partial/garbage buffer, so reject a
 *  malformed payload AT the boundary instead of feeding the transcriber junk. */
const BASE64_RE = /^[A-Za-z0-9+/]*={0,2}$/;

/**
 * The global single-flight lock the collaborative coordinator writes
 * (`~/.moxxy/collab/active.lock`, overridable via `MOXXY_COLLAB_LOCK`). Derived
 * in one place so `collab.active` and `collab.end` can't drift apart — the
 * lock's location is the coordinator's contract, not three hand-edited spots.
 */
function collabLockPath(homedir: string, join: (...parts: string[]) => string): string {
  return process.env.MOXXY_COLLAB_LOCK || join(homedir, '.moxxy', 'collab', 'active.lock');
}

/** Shape of the coordinator's lock record. Validated before we trust `pid`. */
interface CollabLockInfo {
  readonly pid: number;
  readonly sessionId: string;
  readonly task: string;
  readonly startedAtMs: number;
}

/** Parse a lock file's JSON and verify it carries a usable numeric pid — a
 *  truncated/corrupt lock (non-object, missing/garbage pid) is treated as
 *  "no live holder" rather than handed to `process.kill` with a bad value. */
function parseCollabLock(raw: string): CollabLockInfo | null {
  let info: unknown;
  try {
    info = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof info !== 'object' || info === null) return null;
  const rec = info as Record<string, unknown>;
  if (typeof rec.pid !== 'number' || !Number.isInteger(rec.pid) || rec.pid <= 0) return null;
  return {
    pid: rec.pid,
    sessionId: typeof rec.sessionId === 'string' ? rec.sessionId : '',
    task: typeof rec.task === 'string' ? rec.task : '',
    startedAtMs: typeof rec.startedAtMs === 'number' ? rec.startedAtMs : 0,
  };
}

export function registerSessionHandlers(pool: RunnerPool): void {
  // ---- Session (per-workspace) --------------------------------------------

  handle('session.info', async (args) => {
    const sup = resolveSupervisor(pool, args?.workspaceId);
    const session = sup?.remote();
    return session ? session.getInfo() : null;
  });
  handle('session.runTurn', async ({ workspaceId, prompt, model, attachments }) => {
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
    return driver.runTurn(prompt, model, safe);
  });
  handle('session.abortTurn', async ({ workspaceId, turnId }) => {
    // Active-workspace fallback lives in resolveDriver, not inline here.
    resolveDriver(pool, workspaceId)?.abortTurn(turnId);
  });
  handle('session.setProvider', async ({ workspaceId, provider }) => {
    const { session, supervisor } = resolveCtx(pool, { workspaceId });
    session.providers.setActive(provider);
    await waitForSessionState(session, (info) => info.activeProvider === provider);
    // Re-emit the connection phase so the renderer sees the new activeProvider
    // — otherwise the onboarding `connectedWithoutProvider` gate never clears.
    supervisor.refreshConnectedInfo();
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
      const { readFileSync } = await import('node:fs');
      const { homedir } = await import('node:os');
      const { join } = await import('node:path');
      const lockPath = collabLockPath(homedir(), join);
      const info = parseCollabLock(readFileSync(lockPath, 'utf8'));
      // A missing/corrupt lock (or one without a usable pid) → not active.
      if (!info) return { active: false };
      // Liveness: a dead holder pid means the lock is stale → not active.
      try {
        process.kill(info.pid, 0);
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'EPERM') return { active: false };
      }
      return { active: true, sessionId: info.sessionId, task: info.task, startedAtMs: info.startedAtMs };
    } catch {
      return { active: false };
    }
  });
  handle('collab.end', async ({ workspaceId }) => {
    // Abort the coordinator turn (its finally tears the team down + archives),
    // then force-release the global lock so a new collaboration can start —
    // covering a stale lock from a crashed run whose coordinator is unreachable.
    const abortedTurns = resolveDriver(pool, workspaceId)?.abortActiveTurns() ?? 0;
    let clearedTask: string | undefined;
    try {
      const { readFileSync, unlinkSync } = await import('node:fs');
      const { homedir } = await import('node:os');
      const { join } = await import('node:path');
      const lockPath = collabLockPath(homedir(), join);
      try {
        clearedTask = parseCollabLock(readFileSync(lockPath, 'utf8'))?.task || undefined;
      } catch {
        // no lock to read
      }
      try {
        unlinkSync(lockPath);
      } catch {
        // already gone
      }
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
      const { homedir } = await import('node:os');
      const { join } = await import('node:path');
      const home = process.env.MOXXY_HOME || join(homedir(), '.moxxy');
      const dir = join(home, 'collab', 'runs');
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
    // Voice is wired through the desktop's *in-process* Codex
    // transcriber (mirrors the TUI's self-host setup: same vault,
    // same plugin class). Affordance gating: probe the vault for
    // ANY entry under the Codex OAuth namespace
    // (`oauth/openai-codex/*`) — same key prefix the Codex login
    // command writes to. If something's stored, the user has a
    // login → show the mic.
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
  handle('session.transcribe', async ({ audioBase64, mimeType }) => {
    // Run the transcribe through the in-process Codex transcriber —
    // same plugin class, same vault, identical to the TUI's voice
    // path. No round-trip through the runner socket needed (and no
    // RemoteSession.setActive throw to work around).
    const { transcriber } = getInProcessPlugins();
    if (typeof audioBase64 !== 'string' || !BASE64_RE.test(audioBase64)) {
      throw new IpcError('invalid-payload', 'audioBase64 is not valid base64');
    }
    const audio = Buffer.from(audioBase64, 'base64');
    const result = await transcriber.transcribe(
      audio,
      mimeType ? { mimeType } : undefined,
    );
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
  handle('session.saveImageAttachment', async ({ dataBase64, mediaType, name }) =>
    // The renderer can't write files, so a pasted/dropped image's bytes
    // are stashed to a temp file here; the returned path then rides the
    // same attachment pipeline as a picked file.
    persistImageBlob(dataBase64, mediaType, name),
  );
}
