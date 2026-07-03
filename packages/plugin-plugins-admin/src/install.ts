import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import {
  aggregateCapabilitySpecs,
  createMutex,
  defineTool,
  z,
  type CapabilitySpec,
  type ToolIsolationSpec,
} from '@moxxy/sdk';
import { moxxyPath, writeFileAtomic } from '@moxxy/sdk/server';
import { assertSafeNpmSpec, diffSnapshot, NPM_NAME_RE, type PluginSnapshot } from './shared.js';
import { pinFirstPartySpec } from './pin.js';
import { readPluginSetup } from './setup-spec.js';
import { checkCapabilityManifest, resolveInstallSource } from './registry.js';

export type { PluginSnapshot } from './shared.js';

/**
 * Where third-party plugins installed at runtime live. The CLI's
 * `setupSessionWithConfig` already scans this directory (and its
 * `node_modules/` subtree) for plugins, so anything `npm install`'ed
 * here becomes discoverable after a `pluginHost.reload()`.
 */
export function userPluginsDir(): string {
  return moxxyPath('plugins');
}

/**
 * Serializes every npm mutation of the shared `~/.moxxy/plugins` tree. npm does
 * not guard concurrent invocations against the same dir, so two parallel
 * install_plugin tool calls (the loop can dispatch tools concurrently) — or an
 * install racing an uninstall — would run two npm processes mutating the same
 * node_modules / package-lock simultaneously and can corrupt the tree. Mirrors
 * the config mutex; cross-process races (CLI vs running session) remain
 * best-effort. Also closes the ensurePackageJson access→write TOCTOU.
 */
const pluginsDirMutex = createMutex();

// A semver range, dist-tag, or `*`/`latest`. The first character must NOT be a
// dash so a flag-like value (`--evil`, `-g`) is rejected at the schema with a
// clear message rather than producing a malformed `pkg@--evil` spec that npm
// rejects with a confusing error. The leading char is restricted to the legal
// start of a version/range/tag (alnum, `*`, `~`, `^`, `v`, or a range operator
// `<`/`>`/`=`); compound ranges may then contain interior spaces (`>=2 <3`).
const VERSION_RE = /^[0-9a-zA-Z*~^v<>=][0-9a-zA-Z.~^*<=> -]*$/;
// Cap captured npm stderr so a noisy / looping / malicious lifecycle script
// can't grow an unbounded string before the process closes. Only the last 400
// chars are ever surfaced, so a small bounded tail is plenty.
const MAX_STDERR_BYTES = 8 * 1024;
// Grace window after a cooperative SIGTERM (on abort) before escalating to an
// unmaskable SIGKILL. A malicious package's lifecycle script — or a wedged npm —
// can trap/ignore SIGTERM and survive, so a bare SIGTERM does not actually
// guarantee cancellation. Mirrors the SIGTERM→SIGKILL escalation used in
// runner-supervisor / isolator-subprocess.
const SIGKILL_GRACE_MS = 2_000;

export interface InstallPluginDeps {
  /**
   * How the tool triggers a hot-reload after a successful install.
   * Bound at construction so the handler doesn't need to import core.
   */
  readonly reload: () => Promise<void>;
  /**
   * Snapshot of the plugin host before/after reload so we can report
   * which contributions (tools, agents, etc.) the freshly installed
   * package brought in. Returns names per kind.
   */
  readonly snapshot: () => PluginSnapshot;
  /**
   * Host CLI version. When set, bare `@moxxy/*` installs are pinned to it so
   * an on-demand plugin matches the bundled `@moxxy/sdk` it links against
   * (first-party packages co-version via the fixed changeset group). A pin
   * that 404s falls back to `latest` with a warning — see
   * {@link installPluginPackagePinned}.
   */
  readonly cliVersion?: string;
  /**
   * The live isolation spec of a registered tool, when the host can provide
   * it (typically `session.tools.get(name)?.isolation`). Lets install_plugin
   * report the just-installed package's COMBINED capability surface next to
   * the registration diff, so consent decisions see the blast radius, not
   * just tool names. Optional: absent = the report is omitted.
   */
  readonly toolIsolation?: (toolName: string) => ToolIsolationSpec | undefined;
}

export interface InstallPluginPackageOptions {
  /** Full npm install spec: a package name, `name@version`, git, or path. */
  readonly packageName: string;
  /** Optional abort signal; aborting kills the npm child process. */
  readonly signal?: AbortSignal;
}

export interface InstallPluginPackageResult {
  /** The spec that was installed. */
  readonly installed: string;
  /** The plugins directory the package was installed into. */
  readonly dir: string;
}

export interface RemovePluginPackageOptions {
  /** npm package name to uninstall from the plugins directory. */
  readonly packageName: string;
  /** Optional abort signal; aborting kills the npm child process. */
  readonly signal?: AbortSignal;
}

export interface RemovePluginPackageResult {
  /** The package name that was removed. */
  readonly removed: string;
  /** The plugins directory the package was removed from. */
  readonly dir: string;
}

/**
 * Install a plugin package into `~/.moxxy/plugins/` via `npm install`.
 * Imperative counterpart to the `install_plugin` tool, used by the
 * `moxxy plugins install` CLI. Does NOT hot-reload — callers that need new
 * tools to appear in a live session must reload the plugin host themselves.
 */
export async function installPluginPackage(
  opts: InstallPluginPackageOptions,
): Promise<InstallPluginPackageResult> {
  const spec = assertSafeNpmSpec(opts.packageName);
  const dir = userPluginsDir();
  return pluginsDirMutex.run(async () => {
    await ensurePackageJson(dir);
    const { exitCode, stderr } = await runNpm(
      ['install', '--prefix', dir, '--no-fund', '--no-audit', '--save', spec],
      opts.signal,
    );
    if (exitCode !== 0) {
      throw new Error(`npm install failed (exit ${exitCode}): ${truncate(stderr, 400)}`);
    }
    return { installed: spec, dir };
  });
}

export interface PinnedInstallOptions {
  /** Package name or full spec (name@version, git, path). */
  readonly packageName: string;
  /** Explicit version/dist-tag — used verbatim, never retried. */
  readonly version?: string;
  /**
   * Exact version pin from a verified signed-registry entry (see
   * registry.ts). Injected — so a pin that 404s (unpublished release) retries
   * unpinned with a warning rather than failing the install (v1 is
   * availability-first; fail-closed arrives with the consent phase). Ignored
   * when `packageName` already carries a version or is a git/path spec.
   * Precedence: explicit user `version` > this > `cliVersion` > latest.
   */
  readonly pinnedVersion?: string;
  /** Host CLI version to pin bare `@moxxy/*` names to. */
  readonly cliVersion?: string;
  /** Optional abort signal; aborting kills the npm child process. */
  readonly signal?: AbortSignal;
  /** Surfaced when an injected pin 404s and the install retries unpinned. */
  readonly onWarn?: (message: string) => void;
  /** Injectable install fn for tests; defaults to {@link installPluginPackage}. */
  readonly installFn?: (opts: InstallPluginPackageOptions) => Promise<InstallPluginPackageResult>;
}

/**
 * Install with the version pin applied, falling back to the unpinned spec
 * when the pin itself is what failed. Pin precedence: explicit user `version`
 * > signed-registry `pinnedVersion` > first-party `cliVersion` lockstep >
 * latest. The retry only happens for a pin WE injected (a signed pin, or a
 * bare `@moxxy/*` name + cliVersion): an older CLI can legitimately pin a
 * package whose first co-versioned release is newer than the CLI
 * (`@pkg@0.25.0` 404s when the package first ships at 0.26.0). An explicit
 * user-provided version is never second-guessed.
 */
export async function installPluginPackagePinned(
  opts: PinnedInstallOptions,
): Promise<InstallPluginPackageResult> {
  const install = opts.installFn ?? installPluginPackage;
  // A signed pin only applies to a bare package name — a spec that already
  // carries a version (`@scope/name@1.2.3`) or points at git/path installs
  // verbatim (appending `@x.y.z` to those would corrupt the spec).
  const signedPin =
    opts.pinnedVersion && NPM_NAME_RE.test(opts.packageName) ? opts.pinnedVersion : undefined;
  const spec = pinFirstPartySpec(opts.packageName, opts.version ?? signedPin, opts.cliVersion);
  const injectedPin = !opts.version && spec !== opts.packageName;
  try {
    return await install({ packageName: spec, signal: opts.signal });
  } catch (err) {
    if (!injectedPin) throw err;
    opts.onWarn?.(
      `pinned install ${spec} failed (${err instanceof Error ? err.message : String(err)}); ` +
        `retrying latest ${opts.packageName}`,
    );
    return await install({ packageName: opts.packageName, signal: opts.signal });
  }
}

/**
 * Uninstall a plugin package from `~/.moxxy/plugins/` via `npm uninstall`.
 */
export async function removePluginPackage(
  opts: RemovePluginPackageOptions,
): Promise<RemovePluginPackageResult> {
  const spec = assertSafeNpmSpec(opts.packageName);
  const dir = userPluginsDir();
  return pluginsDirMutex.run(async () => {
    await ensurePackageJson(dir);
    const { exitCode, stderr } = await runNpm(
      ['uninstall', '--prefix', dir, '--no-fund', '--no-audit', '--save', spec],
      opts.signal,
    );
    if (exitCode !== 0) {
      throw new Error(`npm uninstall failed (exit ${exitCode}): ${truncate(stderr, 400)}`);
    }
    return { removed: spec, dir };
  });
}

export interface InstallCapabilityReport {
  /** Tools that declared an isolation spec. */
  readonly declared: number;
  /** Tools the install registered. */
  readonly total: number;
  /** Widest-wins union of the declared specs — the package's blast radius. */
  readonly surface: CapabilitySpec;
  /** Tools with NO declaration: their surface is unknown, not empty. */
  readonly undeclaredTools?: ReadonlyArray<string>;
}

/**
 * Combined capability surface of the tools an install just registered.
 * Returns undefined when the install registered no tools (nothing to
 * report — other contribution kinds carry no capability declarations).
 */
export function buildCapabilityReport(
  newTools: ReadonlyArray<string>,
  toolIsolation: NonNullable<InstallPluginDeps['toolIsolation']>,
): InstallCapabilityReport | undefined {
  if (newTools.length === 0) return undefined;
  const specs = newTools.map((n) => toolIsolation(n)?.capabilities);
  const undeclaredTools = newTools.filter((_, i) => !specs[i]);
  return {
    declared: newTools.length - undeclaredTools.length,
    total: newTools.length,
    surface: aggregateCapabilitySpecs(specs),
    ...(undeclaredTools.length ? { undeclaredTools } : {}),
  };
}

export function buildInstallPluginTool(deps: InstallPluginDeps) {
  return defineTool({
    name: 'install_plugin',
    description:
      'Install a moxxy plugin from the npm registry into the user plugin ' +
      'directory (~/.moxxy/plugins/), then hot-reload the plugin host so the ' +
      'new tools / agents / providers / modes / channels become available in ' +
      'the current session. Requires `npm` on PATH. Returns the diff of what ' +
      "got registered. Use this when the user asks to install a moxxy plugin " +
      'they\'ve named (e.g. "install @moxxy/agent-researcher").',
    inputSchema: z.object({
      packageName: z
        .string()
        .min(1)
        .refine((s) => NPM_NAME_RE.test(s), {
          message: 'must be a valid npm package name (e.g. @moxxy/agent-researcher)',
        })
        .describe('npm package name. Scoped (@org/pkg) or bare.'),
      version: z
        .string()
        .optional()
        .refine((v) => v === undefined || VERSION_RE.test(v), {
          message: 'must be a valid semver range or dist-tag',
        })
        .describe('Optional version / dist-tag. Defaults to "latest".'),
    }),
    permission: { action: 'prompt' },
    // install_plugin shells out to `npm install`, which spawns a child
    // process, reads/writes the user plugin dir, and hits the network to
    // fetch packages. These caps are *honest*: the in-process isolator
    // can't constrain what npm does, but a future subprocess/sandbox
    // isolator can use them to confine the install.
    isolation: {
      capabilities: {
        subprocess: true,
        commands: ['npm'],
        net: { mode: 'any' },
        fs: { read: ['$cwd/**'], write: [`${userPluginsDir()}/**`] },
      },
    },
    handler: async ({ packageName, version }, ctx) => {
      const before = deps.snapshot();
      // Consult the signed registry (a no-op fallback while the maintainer
      // key is unprovisioned): a signed entry contributes its exact version
      // pin (unless the user gave one) and its declared capability manifest
      // for the post-install comparison below. Never throws.
      const signed = await resolveInstallSource(packageName, { signal: ctx.signal });
      const signedPin =
        signed.origin === 'signed' && signed.spec === packageName
          ? signed.pinnedVersion
          : undefined;
      const { installed } = await installPluginPackagePinned({
        packageName,
        ...(version ? { version } : {}),
        ...(signedPin ? { pinnedVersion: signedPin } : {}),
        ...(deps.cliVersion ? { cliVersion: deps.cliVersion } : {}),
        signal: ctx.signal,
      });
      await deps.reload();
      const after = deps.snapshot();
      // Surface the plugin's declarative setup step (moxxy.setup) so the
      // caller can walk the user through it — the model relays the hint.
      const setup = await readPluginSetup(packageName.replace(/@[^/@]+$/, ''));
      const registered = diffSnapshot(before, after);
      const capabilities = deps.toolIsolation
        ? buildCapabilityReport(registered.tools ?? [], deps.toolIsolation)
        : undefined;
      // Signed capability manifest vs the surface the install actually
      // registered. Warn-only in v1 (enforce comes with the consent phase).
      const manifestCheck =
        signed.origin === 'signed' && signed.capabilities && capabilities
          ? checkCapabilityManifest(signed.capabilities, capabilities.surface)
          : undefined;
      return {
        installed,
        registered,
        ...(capabilities ? { capabilities } : {}),
        ...(manifestCheck?.capabilityMismatch
          ? {
              capabilityMismatch: true,
              capabilityMismatchDetails: {
                declared: signed.capabilities,
                widened: manifestCheck.widened,
                note: 'installed tools declare a wider surface than the signed registry manifest',
              },
            }
          : {}),
        ...(setup
          ? {
              needsSetup: {
                title: setup.title,
                required: setup.required === true,
                hint: 'Run `moxxy init` to walk through its configuration.',
              },
            }
          : {}),
      };
    },
  });
}

export function buildUninstallPluginTool(deps: InstallPluginDeps) {
  return defineTool({
    name: 'uninstall_plugin',
    description:
      'Uninstall an npm-installed moxxy plugin from the user plugin directory ' +
      '(~/.moxxy/plugins/) via `npm uninstall`, then hot-reload the plugin host so ' +
      'its tools / agents / providers / modes / channels disappear from the current ' +
      'session. Requires `npm` on PATH. Returns the diff of what got unregistered. ' +
      'Use this when the user asks to remove a plugin they installed. NOTE: this only ' +
      'removes npm packages — a scaffolded plugin authored under ~/.moxxy/plugins ' +
      'is removed by rolling back its self-update transaction instead.',
    inputSchema: z.object({
      packageName: z
        .string()
        .min(1)
        .refine((s) => NPM_NAME_RE.test(s), {
          message: 'must be a valid npm package name (e.g. @moxxy/agent-researcher)',
        })
        .describe('npm package name to uninstall. Scoped (@org/pkg) or bare.'),
    }),
    permission: { action: 'prompt' },
    isolation: {
      capabilities: {
        subprocess: true,
        commands: ['npm'],
        fs: { read: ['$cwd/**'], write: [`${userPluginsDir()}/**`] },
      },
    },
    handler: async ({ packageName }, ctx) => {
      const before = deps.snapshot();
      const { removed } = await removePluginPackage({ packageName, signal: ctx.signal });
      await deps.reload();
      const after = deps.snapshot();
      return {
        removed,
        // before-minus-after == contributions the removed package had provided.
        unregistered: diffSnapshot(after, before),
      };
    },
  });
}

/**
 * Make sure `~/.moxxy/plugins/package.json` exists so `npm install`
 * runs cleanly. Created with `private: true` so a stray `npm publish`
 * can't ship our junk dir, and `type: module` so ESM plugins load via
 * Node's loader without surprises.
 */
async function ensurePackageJson(dir: string): Promise<void> {
  const pkgPath = path.join(dir, 'package.json');
  try {
    await fs.access(pkgPath);
  } catch {
    const stub = {
      name: 'moxxy-user-plugins',
      version: '0.0.0',
      private: true,
      type: 'module',
      description: 'Auto-generated workspace for moxxy plugins installed at runtime.',
    };
    await writeFileAtomic(pkgPath, JSON.stringify(stub, null, 2) + '\n');
  }
}

/** The npm executable, resolved per-platform (Windows ships `npm.cmd`). */
const NPM_BIN = process.platform === 'win32' ? 'npm.cmd' : 'npm';

function runNpm(
  args: ReadonlyArray<string>,
  signal?: AbortSignal,
): Promise<{ exitCode: number; stderr: string }> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error('npm aborted before start'));
      return;
    }
    // stdout is ignored (no caller reads it) so a verbose install can't buffer
    // hundreds of MB; stderr is kept as a bounded tail for error reporting.
    const child = spawn(NPM_BIN, [...args], {
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    let stderr = '';
    child.stderr.on('data', (d: Buffer) => {
      stderr += d.toString('utf8');
      if (stderr.length > MAX_STDERR_BYTES) stderr = stderr.slice(-MAX_STDERR_BYTES);
    });
    // Escalation timer armed on abort: if the child ignores/traps SIGTERM it is
    // SIGKILL'd after the grace window so aborting the turn truly cancels npm.
    let killTimer: ReturnType<typeof setTimeout> | undefined;
    const onAbort = (): void => {
      try {
        child.kill('SIGTERM');
      } catch {
        /* already exited */
      }
      killTimer = setTimeout(() => {
        try {
          if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
        } catch {
          /* already exited */
        }
      }, SIGKILL_GRACE_MS);
      // Don't let a pending escalation timer keep the event loop alive.
      killTimer.unref?.();
    };
    const cleanup = (): void => {
      signal?.removeEventListener('abort', onAbort);
      if (killTimer) clearTimeout(killTimer);
    };
    signal?.addEventListener('abort', onAbort, { once: true });
    child.on('error', (err) => {
      cleanup();
      reject(err);
    });
    child.on('close', (code) => {
      cleanup();
      resolve({ exitCode: code ?? -1, stderr });
    });
  });
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : s.slice(0, n - 1) + '…';
}
