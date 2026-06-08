import type { ClientSession as Session } from '@moxxy/sdk';
import { savePreferences } from '@moxxy/core';
import type { Picker } from './types.js';
import { openMcpPicker, openPluginsPicker } from './run-slash.js';

export interface PickerHandlerDeps {
  session: Session;
  providerName: string;
  setPicker: (p: Picker) => void;
  setSystemNotice: (msg: string | null) => void;
  setActiveModelOverride: (id: string) => void;
  refreshMcpStatus: () => Promise<void>;
}

export function makePickerHandler(deps: PickerHandlerDeps): (picker: Picker, id: string) => void {
  return (picker, id) => {
    if (!picker) return;
    const kind = picker.kind;
    deps.setPicker(null);
    if (kind === 'mcp-server') {
      return handleMcpServerSelected(id, deps);
    }
    if (kind === 'mcp-action') {
      return handleMcpAction(picker.serverName, id, deps);
    }
    if (kind === 'model') {
      return handleModelSelected(id, deps);
    }
    if (kind === 'mode') {
      return handleModeSelected(id, deps);
    }
    if (kind === 'plugins') {
      return handlePluginAction(id, deps);
    }
  };
}

/**
 * Apply a `/plugins` picker selection. Option ids are `<name>::<action>`:
 * `enable` / `disable` plug or unplug the plugin (persisted + hot-applied via
 * session.pluginsAdmin), `install` prints the install command. After a toggle
 * the picker re-opens so the user sees fresh state and can keep toggling.
 */
function handlePluginAction(id: string, deps: PickerHandlerDeps): void {
  const admin = deps.session.pluginsAdmin;
  const sep = id.lastIndexOf('::');
  const name = sep >= 0 ? id.slice(0, sep) : id;
  const action = sep >= 0 ? id.slice(sep + 2) : '';
  if (action === 'install') {
    deps.setSystemNotice(`to install: run \`moxxy plugins install ${name}\``);
    return;
  }
  if (action !== 'enable' && action !== 'disable') return;
  if (!admin) {
    deps.setSystemNotice('plugin management is not available on this session');
    return;
  }
  const enable = action === 'enable';
  void (async () => {
    try {
      await admin.setEnabled(name, enable);
      deps.setSystemNotice(`${enable ? '✓ enabled' : '✗ disabled'} ${name}`);
    } catch (err) {
      deps.setSystemNotice(
        `plugin ${action} failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      // Re-open with refreshed loaded/disabled state so the toggle is visible.
      openPluginsPicker(deps);
    }
  })();
}

function handleMcpServerSelected(id: string, deps: PickerHandlerDeps): void {
  // Step 2 of the /mcp flow: opened the action picker for the
  // selected server. We need to re-derive the disabled flag for the
  // action label so the picker accurately reads "disable" vs "enable".
  void (async () => {
    try {
      const { readMcpConfig } = await import('@moxxy/plugin-mcp');
      const cfg = await readMcpConfig();
      const server = cfg.servers.find((s) => s.name === id);
      const isDisabled = server?.disabled ?? false;
      const toggleLabel = isDisabled ? 'Enable' : 'Disable';
      deps.setPicker({
        kind: 'mcp-action',
        title: `${id} — pick an action`,
        serverName: id,
        options: [
          {
            id: 'toggle',
            label: toggleLabel,
            description: isDisabled
              ? 'register lazy stubs in this session'
              : 'detach live tools; keep config',
          },
          { id: 'remove', label: 'Remove', description: 'delete from ~/.moxxy/mcp.json' },
          { id: 'cancel', label: 'Cancel', description: 'close without changing anything' },
        ],
      });
    } catch (err) {
      deps.setSystemNotice(
        `failed to load action picker: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  })();
}

function handleMcpAction(serverName: string, id: string, deps: PickerHandlerDeps): void {
  if (id === 'cancel') {
    // Cancel pops back to the server list rather than closing the
    // whole modal — users hit Cancel when they picked the wrong
    // server, not because they want to abandon /mcp entirely.
    openMcpPicker(deps);
    return;
  }
  void (async () => {
    try {
      const { readMcpConfig, setServerDisabled, removeServerFromConfig } = await import(
        '@moxxy/plugin-mcp'
      );
      if (id === 'remove') {
        const ok = await removeServerFromConfig(serverName);
        const api = deps.session.mcpAdmin;
        if (api) await api.detach(serverName);
        deps.setSystemNotice(
          ok ? `✓ removed MCP server "${serverName}"` : `no MCP server named "${serverName}"`,
        );
        return;
      }
      if (id === 'toggle') {
        const cfg = await readMcpConfig();
        const current = cfg.servers.find((s) => s.name === serverName);
        if (!current) {
          deps.setSystemNotice(`no MCP server named "${serverName}"`);
          return;
        }
        const nextDisabled = !current.disabled;
        await setServerDisabled(serverName, nextDisabled);
        const api = deps.session.mcpAdmin;
        if (api) {
          if (nextDisabled) {
            await api.detach(serverName);
          } else {
            const r = await api.enableAndAttach(serverName);
            deps.setSystemNotice(
              r
                ? `✓ enabled "${serverName}" — ${r.toolNames.length} tool${r.toolNames.length === 1 ? '' : 's'} attached`
                : `enabled "${serverName}" in config but live attach failed`,
            );
            return;
          }
        }
        deps.setSystemNotice(`${nextDisabled ? '✗ disabled' : '✓ enabled'} "${serverName}"`);
      }
    } catch (err) {
      deps.setSystemNotice(
        `MCP action failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      void deps.refreshMcpStatus();
    }
  })();
}

function handleModelSelected(id: string, deps: PickerHandlerDeps): void {
  const [providerId, modelId] = id.split('::');
  if (!providerId || !modelId) return;
  // If the provider wasn't in the boot probe's ready set, switching
  // would surface a credential error on the next turn. Intercept
  // here and surface the right configuration command instead.
  const ready = deps.session.readyProviders ?? new Set<string>();
  if (!ready.has(providerId)) {
    const cmd =
      providerId === 'openai-codex'
        ? 'moxxy login openai-codex'
        : `moxxy init   # (will prompt for ${providerId.toUpperCase()}_API_KEY)`;
    deps.setSystemNotice(
      `${providerId} isn't connected. Run \`${cmd}\` then restart moxxy.\n` +
        `Alternatively set the ${providerId.toUpperCase()}_API_KEY env var before launching.`,
    );
    return;
  }
  // Provider switches must resolve credentials (vault tokens for
  // OAuth providers, API keys for the rest) before setActive — the
  // registry caches the instance on first activation, so passing
  // empty config strands the new provider without auth. The CLI
  // stashes a credentialResolver on the session at boot.
  void (async () => {
    try {
      if (providerId !== deps.providerName) {
        const resolver = deps.session.credentialResolver;
        const cfg = resolver ? await resolver(providerId) : {};
        // Drop any previously-cached instance for this provider so the
        // freshly-resolved credentials actually take effect — setActive
        // alone keeps the first-cached instance.
        const def = deps.session.providers.list().find((p) => p.name === providerId);
        if (def) deps.session.providers.replace(def);
        deps.session.providers.setActive(providerId, cfg);
      }
      deps.setActiveModelOverride(modelId);
      deps.setSystemNotice(`switched to ${providerId}:${modelId}`);
      void savePreferences({ providerName: providerId, model: modelId });
    } catch (err) {
      deps.setSystemNotice(
        `failed to switch: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  })();
}

function handleModeSelected(id: string, deps: PickerHandlerDeps): void {
  try {
    deps.session.modes.setActive(id);
    deps.setSystemNotice(`mode → ${id}`);
    void savePreferences({ mode: id });
  } catch (err) {
    deps.setSystemNotice(
      `failed to switch mode: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}
