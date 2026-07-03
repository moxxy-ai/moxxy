import type { Session } from '@moxxy/core';
import type { PluginSnapshot } from '@moxxy/plugin-plugins-admin';

/**
 * Names of currently-registered contributions, per kind. One implementation
 * shared by the plugins-admin model tools (install/uninstall diff reporting)
 * and the `session.pluginsAdmin.install` view closure so the two can't drift.
 */
export function buildPluginSnapshot(session: Session): PluginSnapshot {
  return {
    tools: session.tools.list().map((t) => t.name),
    agents: session.agents.list().map((a) => a.name),
    providers: session.providers.list().map((p) => p.name),
    modes: session.modes.list().map((l) => l.name),
    compactors: session.compactors.list().map((c) => c.name),
    channels: session.channels.list().map((c) => c.name),
  };
}
