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
  drivers,
  getInProcessPlugins,
  handle,
  mustDriver,
  resolveCtx,
  resolveSupervisor,
  waitForSessionState,
} from './shared';

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
    const id = workspaceId ?? pool.activeWorkspaceId();
    if (!id) return;
    drivers.get(id)?.abortTurn(turnId);
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
      session: session as unknown as Parameters<typeof def.handler>[0]['session'],
    });
    return result;
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
    const result = await dialog.showOpenDialog(window ?? null!, {
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
    });
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
