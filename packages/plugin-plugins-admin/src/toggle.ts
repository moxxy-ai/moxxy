import { defineTool, z } from '@moxxy/sdk';
import type { PluginSnapshot } from './install.js';

const NPM_NAME_RE = /^(?:@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/;

export interface PluginToggleDeps {
  /**
   * Persist `plugins[packageName].enabled` to the user config AND apply the
   * change to the live session (unload on disable; register/reload on enable),
   * keeping the PluginHost's disabled-set in sync so a later reload honors it.
   * Bound in the CLI's builtins wiring, which owns the session + config access.
   */
  readonly setEnabled: (packageName: string, enabled: boolean) => Promise<void>;
  /** Snapshot of registered contributions, for reporting the enable/disable diff. */
  readonly snapshot: () => PluginSnapshot;
}

export function buildDisablePluginTool(deps: PluginToggleDeps) {
  return defineTool({
    name: 'disable_plugin',
    description:
      'Disable (unplug) a registered moxxy plugin — a default builtin or an ' +
      'installed one — by package name. Persists `plugins[<name>].enabled=false` ' +
      'to ~/.moxxy/config.yaml and unloads it from the running session, so its ' +
      'tools / agents / providers / modes / channels disappear immediately and ' +
      'it stays off across restarts. Reverse with enable_plugin. Use when the ' +
      'user wants to turn a plugin off without uninstalling it.',
    inputSchema: z.object({
      packageName: z
        .string()
        .min(1)
        .refine((s) => NPM_NAME_RE.test(s), {
          message: 'must be a valid moxxy package name (e.g. @moxxy/plugin-browser)',
        })
        .describe('Plugin package name to disable, e.g. @moxxy/plugin-browser.'),
    }),
    permission: { action: 'prompt' },
    handler: async ({ packageName }) => {
      const before = deps.snapshot();
      await deps.setEnabled(packageName, false);
      const after = deps.snapshot();
      return { disabled: packageName, unregistered: diffSnapshot(after, before) };
    },
  });
}

export function buildEnablePluginTool(deps: PluginToggleDeps) {
  return defineTool({
    name: 'enable_plugin',
    description:
      'Enable (plug back in) a previously-disabled moxxy plugin by package name. ' +
      'Persists `plugins[<name>].enabled=true` to ~/.moxxy/config.yaml and loads ' +
      'it into the running session (re-registering a default or re-discovering an ' +
      'installed plugin), so its contributions reappear immediately. Reverse with ' +
      'disable_plugin. Use when the user wants to turn a disabled plugin back on.',
    inputSchema: z.object({
      packageName: z
        .string()
        .min(1)
        .refine((s) => NPM_NAME_RE.test(s), {
          message: 'must be a valid moxxy package name (e.g. @moxxy/plugin-browser)',
        })
        .describe('Plugin package name to enable, e.g. @moxxy/plugin-browser.'),
    }),
    permission: { action: 'prompt' },
    handler: async ({ packageName }) => {
      const before = deps.snapshot();
      await deps.setEnabled(packageName, true);
      const after = deps.snapshot();
      return { enabled: packageName, registered: diffSnapshot(before, after) };
    },
  });
}

function diffSnapshot(
  before: PluginSnapshot,
  after: PluginSnapshot,
): Record<string, ReadonlyArray<string>> {
  const out: Record<string, ReadonlyArray<string>> = {};
  for (const key of ['tools', 'agents', 'providers', 'modes', 'compactors', 'channels'] as const) {
    const b = new Set(before[key]);
    const added = after[key].filter((n) => !b.has(n));
    if (added.length > 0) out[key] = added;
  }
  return out;
}
