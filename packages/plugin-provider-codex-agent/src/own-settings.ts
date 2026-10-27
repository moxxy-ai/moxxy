/**
 * How the person's own Codex runs, read without starting a thread: a
 * short-lived `codex app-server` answers `config/read` for the folder (the
 * effective config, profiles and project config included) and is closed.
 */
import { JsonRpcLineClient } from '@moxxy/agent-connection-kit';
import type { StartCodexAppServer } from './codex-session.js';
import type { CodexConfigRead } from './protocol.js';

/** Codex answers in well under a second; one stuck on startup is not waited on longer. */
const OWN_SETTINGS_TIMEOUT_MS = 15_000;

/**
 * Whether the person's own Codex runs in `cwd` with no approvals and full
 * access, as Moxxy's auto-approve does; `undefined` when Codex cannot say.
 */
export async function codexOwnAutoApprove(
  cwd: string,
  start: StartCodexAppServer,
  opts: { readonly timeoutMs?: number } = {},
): Promise<boolean | undefined> {
  let connection: Awaited<ReturnType<StartCodexAppServer>> | undefined;
  let client: JsonRpcLineClient | undefined;
  const timer = setTimeout(() => client?.close(new Error('Codex did not answer in time.')), opts.timeoutMs ?? OWN_SETTINGS_TIMEOUT_MS);
  try {
    connection = await start({ cwd });
    client = new JsonRpcLineClient({ readable: connection.readable, writable: connection.writable });
    await client.request('initialize', { clientInfo: { name: 'moxxy', title: 'Moxxy', version: '1' }, capabilities: { experimentalApi: true } });
    client.notify('initialized');
    const { config } = await client.request<CodexConfigRead>('config/read', { cwd });
    return config.approval_policy === 'never' && config.sandbox_mode === 'danger-full-access';
  } catch {
    return undefined;
  } finally {
    clearTimeout(timer);
    client?.close();
    connection?.close();
  }
}
