import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import type { SessionId, ToolContext, TurnId } from '@moxxy/sdk';
import type { RegistrySnapshot } from './transaction.js';
import { detectCoreInstall, type CoreInstallInfo } from './core-update.js';

export const PLUGIN_ID = '@moxxy/plugin-self-update';

export interface SkipInfo {
  readonly pluginName: string;
  readonly packageName?: string;
  readonly message: string;
}

export interface SelfUpdateEmit {
  readonly subtype: string;
  readonly payload: unknown;
  readonly sessionId: SessionId;
  readonly turnId: TurnId;
}

export interface SelfUpdateDeps {
  /** Base user dir, normally `~/.moxxy`. Overridable for tests. */
  readonly moxxyDir: string;
  /** Hot-reload the plugin host (rescans user plugin dirs). */
  readonly reload: () => Promise<void>;
  /** Unload a plugin by name so a modified version re-imports fresh on reload. */
  readonly unload: (name: string) => Promise<void>;
  /** Current registered contribution names per kind. */
  readonly snapshot: () => RegistrySnapshot;
  /** Plugins the host failed to load (so we can surface a load error). */
  readonly skipped: () => ReadonlyArray<SkipInfo>;
  /** Append a `plugin_event` audit record. Best-effort. */
  readonly emit: (e: SelfUpdateEmit) => Promise<void>;
  /** How many terminal transactions to keep on GC. Default 5. */
  readonly maxTxnRetained?: number;
  /** Tier-2 core-patching config. Omit or set enabled:false to hide core tools. */
  readonly coreUpdate?: {
    /** Enable the Tier-2 core-update tools. Default true. */
    readonly enabled?: boolean;
    /** Module URL used to resolve the live @moxxy/core install. Default import.meta.url. */
    readonly fromUrl?: string;
    /** Override the git repository URL (else read from @moxxy/core package.json). */
    readonly repoUrlOverride?: string;
  };
}

export async function readJsonName(dir: string): Promise<string | undefined> {
  try {
    const pkg = JSON.parse(await fs.readFile(path.join(dir, 'package.json'), 'utf8')) as {
      name?: string;
    };
    return pkg.name;
  } catch {
    return undefined;
  }
}

export function findSkip(
  skipped: ReadonlyArray<SkipInfo>,
  names: ReadonlyArray<string>,
): SkipInfo | undefined {
  const want = new Set(names.filter(Boolean));
  return skipped.find((s) => want.has(s.pluginName) || (s.packageName ? want.has(s.packageName) : false));
}

export async function emitSafe(
  deps: SelfUpdateDeps,
  ctx: ToolContext,
  subtype: string,
  payload: unknown,
): Promise<void> {
  await deps
    .emit({ subtype, payload, sessionId: ctx.sessionId, turnId: ctx.turnId })
    .catch(() => undefined);
}

/**
 * The fromUrl default is provided by the caller — `detectCoreInstall` resolves
 * the live `@moxxy/core` install relative to that module URL.
 */
export function resolveCoreInstall(deps: SelfUpdateDeps, fromUrlDefault: string): CoreInstallInfo | null {
  return detectCoreInstall(deps.coreUpdate?.fromUrl ?? fromUrlDefault);
}
