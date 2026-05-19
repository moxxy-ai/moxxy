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
import type { MoxxyEvent, PermissionResolver, SessionId } from '@moxxy/sdk';
import type { MoxxyConfig } from '@moxxy/config';

export interface BuildSessionArgs {
  readonly cwd: string;
  readonly config: MoxxyConfig;
  readonly resolver?: PermissionResolver;
  readonly resumeSessionId?: string;
  readonly logger: Logger;
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

  let restoredEvents: ReadonlyArray<MoxxyEvent> = [];
  if (args.resumeSessionId) {
    try {
      restoredEvents = await restoreSessionEvents(args.resumeSessionId);
    } catch (err) {
      throw new Error(
        `Failed to resume session ${args.resumeSessionId}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  return new Session({
    cwd: args.cwd,
    logger: args.logger,
    permissionEngine,
    permissionResolver: args.resolver ?? denyByDefaultResolver,
    hookTimeoutMs: args.config.hookTimeoutMs,
    pluginLoader: createPluginLoader({ cwd: args.cwd }),
    ...(args.resumeSessionId ? { sessionId: args.resumeSessionId as SessionId } : {}),
    // Seed restored events directly into the log so subscribers don't
    // re-fire side effects for historical events. New appends from this
    // point onward fire subscribers normally (and the persistence
    // subscriber continues writing to the same JSONL file).
    ...(restoredEvents.length > 0 ? { log: new EventLog(restoredEvents) } : {}),
  });
}
