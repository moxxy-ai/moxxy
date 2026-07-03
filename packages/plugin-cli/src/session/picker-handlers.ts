import type { ClientSession as Session } from '@moxxy/sdk';
import { loadConfig, setCategoryDefault, setConfigValue, setProviderModel } from '@moxxy/config';
import type { Picker } from './types.js';
import {
  openMcpPicker,
  openModelPicker,
  openModePicker,
  openPluginsPicker,
  openSettingsPicker,
} from './run-slash.js';
import { findKnob } from './settings-descriptors.js';
import { NEW_SESSION_OPTION_ID, type SessionSwitchTarget } from './sessions-picker.js';

export interface PickerHandlerDeps {
  session: Session;
  providerName: string;
  setPicker: (p: Picker) => void;
  setSystemNotice: (msg: string | null) => void;
  setActiveModelOverride: (id: string) => void;
  refreshMcpStatus: () => Promise<void>;
  /**
   * Re-point the TUI onto a different session. Provided by BootShell (it owns
   * the session state + re-mount); resolves on success, rejects on failure.
   * Absent ⇒ `/sessions` never opened a picker, so this branch is unreachable.
   */
  requestSessionSwitch?: (target: SessionSwitchTarget) => Promise<void>;
  /**
   * True while a picker-driven npm install runs; a second install pick gets a
   * "still installing" notice instead of silently queueing behind the mutex.
   */
  installInFlightRef?: { current: boolean };
  /**
   * Open the inline provider-connect dialog for an unconnected provider
   * picked in `/model` (SessionView owns the dialog state). Absent — or when
   * the session has no `providerSetup` capability — the picker falls back to
   * the "run moxxy init/login" notice.
   */
  openProviderConnect?: (target: { providerId: string; modelId: string }) => void;
  /**
   * Re-dispatch a slash line through the normal submit path. Used by the
   * install-confirm picker to re-run the command that hit the missing
   * capability (e.g. `/goal fix the build`) after the install lands — the
   * original code path then finds the contribution registered.
   */
  rerunSlash?: (line: string) => void;
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
    if (kind === 'install-confirm') {
      return handleInstallConfirm(picker, id, deps);
    }
    if (kind === 'settings') {
      return handleSettingSelected(id, deps);
    }
    if (kind === 'sessions') {
      return handleSessionSelected(id, deps);
    }
  };
}

/**
 * Apply a `/settings` knob pick: booleans toggle, enums cycle — persisted to
 * the USER config through the shared schema-validated writer, then
 * live-applied via `session.configAdmin` (absent on a RemoteSession → the
 * write lands and the notice says it applies on restart). Link rows re-open
 * the matching picker; readonly rows explain where to edit. The panel
 * re-opens with fresh badges after every write.
 */
function handleSettingSelected(id: string, deps: PickerHandlerDeps): void {
  const knob = findKnob(id);
  if (!knob) return;
  if (knob.kind === 'link') {
    // Re-opening the model/mode picker needs the fuller SlashDeps surface;
    // the ones the openers actually touch are present on PickerHandlerDeps.
    if (knob.opens === 'model') openModelPicker(deps as never);
    else openModePicker(deps as never);
    return;
  }
  if (knob.kind === 'readonly') {
    deps.setSystemNotice(`${knob.label}: ${knob.description}`);
    return;
  }
  void (async () => {
    try {
      const { config } = await loadConfig({ cwd: process.cwd() });
      const value = knob.next!(config);
      await setConfigValue({
        scope: 'user',
        cwd: process.cwd(),
        path: knob.dotPath!,
        value,
      });
      const admin = deps.session.configAdmin;
      if (admin) {
        const res = await admin.apply();
        const appliedNow = res.applied.length > 0;
        deps.setSystemNotice(
          `✓ ${knob.label} → ${JSON.stringify(value)}${appliedNow ? '' : ' — applies on restart'}`,
        );
      } else {
        deps.setSystemNotice(`✓ ${knob.label} → ${JSON.stringify(value)} — applies on restart`);
      }
    } catch (err) {
      deps.setSystemNotice(
        `failed to update ${knob.label}: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      openSettingsPicker(deps);
    }
  })();
}

/**
 * The shared picker-driven install flow: guard for capability + in-flight,
 * progress/success/failure notices, then `after` (reopen a picker, re-run a
 * slash line). Used by the /plugins Installable tab and install-confirm.
 */
function runPickerInstall(
  deps: PickerHandlerDeps,
  target: string,
  opts: { reopenPluginsPicker?: boolean; onSuccess?: () => void } = {},
): void {
  const admin = deps.session.pluginsAdmin;
  const install = admin?.install?.bind(admin);
  if (!install) {
    deps.setSystemNotice(`to install: run \`moxxy plugins install ${target}\``);
    return;
  }
  if (deps.installInFlightRef?.current) {
    deps.setSystemNotice('an install is already running — hang on…');
    return;
  }
  if (deps.installInFlightRef) deps.installInFlightRef.current = true;
  deps.setSystemNotice(`installing ${target} via npm — this can take a minute…`);
  void (async () => {
    let ok = false;
    try {
      const res = await install(target);
      const kinds = Object.entries(res.registered)
        .filter(([, names]) => names && names.length > 0)
        .map(([kind, names]) => `${kind}: ${names!.join(', ')}`)
        .join('; ');
      deps.setSystemNotice(`✓ installed ${res.installed}${kinds ? ` — registered ${kinds}` : ''}`);
      ok = true;
    } catch (err) {
      deps.setSystemNotice(
        `install failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      if (deps.installInFlightRef) deps.installInFlightRef.current = false;
      // Re-open with refreshed state: a success moves the plugin from the
      // Installable tab into Packages; a failure keeps it installable.
      if (opts.reopenPluginsPicker) openPluginsPicker(deps);
    }
    if (ok) opts.onSuccess?.();
  })();
}

/**
 * `install-confirm` picker: `install` runs the shared install flow and, on
 * success, re-runs the original slash line so the user continues through the
 * unmodified code path; anything else closes silently.
 */
function handleInstallConfirm(
  picker: Extract<NonNullable<Picker>, { kind: 'install-confirm' }>,
  id: string,
  deps: PickerHandlerDeps,
): void {
  if (id !== 'install') return;
  runPickerInstall(deps, picker.catalogId, {
    onSuccess: () => deps.rerunSlash?.(picker.rerun),
  });
}

/**
 * Apply a `/sessions` picker selection. The synthetic "+ New session" entry
 * boots a fresh session; any other id resumes that persisted session. Picking
 * the session you're already in is a no-op (avoids a pointless re-bootstrap).
 * The actual switch — closing the live session, re-pointing the runner socket,
 * booting the new one — is the host's job (BootShell's `requestSessionSwitch`).
 */
function handleSessionSelected(id: string, deps: PickerHandlerDeps): void {
  const requestSwitch = deps.requestSessionSwitch;
  if (!requestSwitch) {
    deps.setSystemNotice('switching sessions is not available on this session');
    return;
  }
  if (id === deps.session.id) {
    deps.setSystemNotice("you're already in that session");
    return;
  }
  const target: SessionSwitchTarget =
    id === NEW_SESSION_OPTION_ID ? { kind: 'new' } : { kind: 'resume', id };
  deps.setSystemNotice(id === NEW_SESSION_OPTION_ID ? 'starting a new session…' : 'switching…');
  // On success the view re-mounts onto the new session (this strip is gone); on
  // failure the current session stays and we surface the error here.
  void requestSwitch(target).catch((err: unknown) => {
    deps.setSystemNotice(
      `failed to switch session: ${err instanceof Error ? err.message : String(err)}`,
    );
  });
}

/**
 * Apply a `/plugins` picker selection. Option ids are `<name>::<action>`:
 * `enable` / `disable` plug or unplug the plugin (persisted + hot-applied via
 * session.pluginsAdmin), `install` npm-installs + enables + hot-reloads it
 * (falling back to printing the CLI command when the session can't install —
 * e.g. a RemoteSession). After a toggle the picker re-opens so the user sees
 * fresh state and can keep toggling.
 */
function handlePluginAction(id: string, deps: PickerHandlerDeps): void {
  const admin = deps.session.pluginsAdmin;
  const sep = id.lastIndexOf('::');
  const name = sep >= 0 ? id.slice(0, sep) : id;
  const action = sep >= 0 ? id.slice(sep + 2) : '';
  if (action === 'install') {
    runPickerInstall(deps, name, { reopenPluginsPicker: true });
    return;
  }
  if (action === 'core') {
    deps.setSystemNotice(`${name} is a core module and can't be disabled — swap its default instead`);
    return;
  }
  if (action === 'setdefault') {
    // id is `<category>::<contribution>::setdefault`; `name` holds the rest.
    if (!admin) {
      deps.setSystemNotice('plugin management is not available on this session');
      return;
    }
    const split = name.indexOf('::');
    const category = split >= 0 ? name.slice(0, split) : name;
    const contribution = split >= 0 ? name.slice(split + 2) : '';
    void (async () => {
      try {
        await admin.setCategoryDefault(category, contribution);
        deps.setSystemNotice(`✓ ${category} default → ${contribution}`);
      } catch (err) {
        deps.setSystemNotice(
          `set default failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      } finally {
        openPluginsPicker(deps);
      }
    })();
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
  // would surface a credential error on the next turn. Connect it inline
  // when the session can (install + key entry / OAuth in a dialog);
  // otherwise surface the right configuration command.
  const ready = deps.session.readyProviders ?? new Set<string>();
  if (!ready.has(providerId)) {
    if (deps.session.providerSetup && deps.openProviderConnect) {
      deps.openProviderConnect({ providerId, modelId });
      return;
    }
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
  void applyProviderModelSwitch(deps, providerId, modelId);
}

/**
 * The provider+model switch tail — credential resolution, instance replace,
 * setActive, model override, persistence. Shared by the ready-provider path
 * and the post-connect continuation (the connect dialog's onSuccess), so a
 * freshly-connected provider switches through EXACTLY the same code.
 */
export async function applyProviderModelSwitch(
  deps: Pick<
    PickerHandlerDeps,
    'session' | 'providerName' | 'setSystemNotice' | 'setActiveModelOverride'
  >,
  providerId: string,
  modelId: string,
): Promise<void> {
  // Provider switches must resolve credentials (vault tokens for
  // OAuth providers, API keys for the rest) before setActive — the
  // registry caches the instance on first activation, so passing
  // empty config strands the new provider without auth. The CLI
  // stashes a credentialResolver on the session at boot.
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
    // Persist to the unified manifest so the next boot keeps this pick.
    void setCategoryDefault('provider', providerId).catch(() => undefined);
    void setProviderModel(providerId, modelId).catch(() => undefined);
  } catch (err) {
    deps.setSystemNotice(
      `failed to switch: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

function handleModeSelected(id: string, deps: PickerHandlerDeps): void {
  // Catalog modes appended by openModePicker carry `install::<name>` ids —
  // install the providing package, then re-run `/mode <name>`.
  if (id.startsWith('install::')) {
    const modeName = id.slice('install::'.length);
    const entry = deps.session.pluginsAdmin
      ?.catalog()
      .find((e) => e.provides?.some((p) => p.category === 'mode' && p.name === modeName));
    if (!entry) {
      deps.setSystemNotice(`no installable package provides mode "${modeName}"`);
      return;
    }
    runPickerInstall(deps, entry.id, {
      onSuccess: () => deps.rerunSlash?.(`/mode ${modeName}`),
    });
    return;
  }
  try {
    deps.session.modes.setActive(id);
    deps.setSystemNotice(`mode → ${id}`);
    void setCategoryDefault('mode', id).catch(() => undefined);
  } catch (err) {
    deps.setSystemNotice(
      `failed to switch mode: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}
