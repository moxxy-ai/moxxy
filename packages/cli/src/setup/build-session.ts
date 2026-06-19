import * as os from 'node:os';
import * as path from 'node:path';
import {
  EventLog,
  PermissionEngine,
  Session,
  createPluginLoader,
  denyByDefaultResolver,
  restoreSessionEvents,
  type Logger,
} from '@moxxy/core';
import { MoxxyError, type MoxxyEvent, type PermissionResolver, type SessionId } from '@moxxy/sdk';
import type { MoxxyConfig } from '@moxxy/config';

export interface BuildSessionArgs {
  readonly cwd: string;
  readonly config: MoxxyConfig;
  readonly resolver?: PermissionResolver;
  readonly resumeSessionId?: string;
  /**
   * Sticky session id (resume-if-present). Use this exact id; restore its
   * persisted log if one exists, otherwise start a fresh session under the same
   * id. Ignored when `resumeSessionId` is set.
   */
  readonly sessionId?: string;
  readonly logger: Logger;
  /**
   * Vault-backed secret resolver, surfaced to every tool handler as
   * `ctx.getSecret(name)`. The caller wires this to the session vault's
   * `get` so authored plugins can read an API key at call time without the
   * value entering the model's context or `process.env`.
   */
  readonly secretResolver?: (name: string) => Promise<string | null>;
  /**
   * Predicate (by package name) for whether a discovered plugin is disabled,
   * forwarded to the PluginHost so `reload()` honors runtime/config disables.
   */
  readonly isPluginDisabled?: (packageName: string) => boolean;
}

/**
 * Construct a `Session` with permissions, plugin loader, and (if
 * resuming) replayed events seeded into the log so subscribers don't
 * re-fire side effects for historical events.
 */
export async function buildSession(args: BuildSessionArgs): Promise<Session> {
  const userPolicyPath =
    args.config.permissions?.policyPath ?? path.join(os.homedir(), '.moxxy', 'permissions.json');
  const permissionEngine = await PermissionEngine.load(userPolicyPath);

  // The effective session id: an explicit `--resume <id>` (errors if missing),
  // or a sticky `sessionId` (resume-if-present, fresh on first run). Both reuse
  // the id so persistence appends continue the same `<id>.jsonl`.
  const effectiveSessionId = args.resumeSessionId ?? args.sessionId;
  let restoredEvents: ReadonlyArray<MoxxyEvent> = [];
  if (args.resumeSessionId) {
    try {
      restoredEvents = await restoreSessionEvents(args.resumeSessionId);
    } catch (err) {
      throw new MoxxyError({
        code: 'CONFIG_INVALID',
        message: `Failed to resume session "${args.resumeSessionId}".`,
        hint:
          `The persisted session may be missing or corrupted. Run \`moxxy sessions list\` to ` +
          `see available sessions, or start a fresh one without --resume.`,
        context: { session_id: args.resumeSessionId },
        cause: err,
      });
    }
  } else if (args.sessionId) {
    // Sticky resume: a missing log just means "first run with this id" — start
    // fresh under it rather than erroring (unlike explicit `--resume`). But only
    // a genuine "not found" is benign: any OTHER failure (permission/IO error,
    // an unexpected throw) would otherwise silently drop existing history and
    // let a fresh session overwrite the same `<id>.jsonl`. Surface those so the
    // loss isn't silent, then still start fresh to keep boot resilient.
    try {
      restoredEvents = await restoreSessionEvents(args.sessionId);
    } catch (err) {
      restoredEvents = [];
      const msg = err instanceof Error ? err.message : String(err);
      if (!/not found/i.test(msg)) {
        args.logger.warn(
          'sticky-resume: could not restore session log; starting fresh under the same id',
          { session_id: args.sessionId, error: msg },
        );
      }
    }
  }

  const userPluginsDir = path.join(os.homedir(), '.moxxy', 'plugins');

  return new Session({
    cwd: args.cwd,
    logger: args.logger,
    permissionEngine,
    permissionResolver: args.resolver ?? denyByDefaultResolver,
    hookTimeoutMs: args.config.hookTimeoutMs,
    pluginLoader: createPluginLoader({ cwd: args.cwd }),
    // Mirror the discovery roots register-plugins.ts uses for the initial
    // scan, so pluginHost.reload() (install_plugin, self-update) rediscovers
    // and preserves runtime-installed / scaffolded plugins.
    pluginDiscoveryPaths: [userPluginsDir, path.join(userPluginsDir, 'node_modules')],
    ...(args.isPluginDisabled ? { isPluginDisabled: args.isPluginDisabled } : {}),
    ...(args.secretResolver ? { secretResolver: args.secretResolver } : {}),
    ...(effectiveSessionId ? { sessionId: effectiveSessionId as SessionId } : {}),
    // Seed restored events directly into the log so subscribers don't
    // re-fire side effects for historical events. New appends from this
    // point onward fire subscribers normally (and the persistence
    // subscriber continues writing to the same JSONL file).
    ...(restoredEvents.length > 0 ? { log: new EventLog(restoredEvents) } : {}),
  });
}
