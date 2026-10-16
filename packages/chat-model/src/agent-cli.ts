import type { AgentCliReport } from '@moxxy/sdk';

export interface AgentCliNotice {
  readonly provider: string;
  /** The CLI's command, which names it to `moxxy agents`. */
  readonly command: string;
  /** `required`: the connection cannot work until it is installed or updated. */
  readonly severity: 'required' | 'available';
  /** What fixes it. */
  readonly action: 'install' | 'update';
  readonly text: string;
}

/** What a surface knows of a connection: its name, the agent's, and the last check of its CLI. */
export interface AgentConnectionLike {
  readonly name: string;
  readonly agentName?: string;
  readonly agentCli?: AgentCliReport;
}

/**
 * What to tell the person about an agent connection's CLI — missing, too old,
 * or behind the vendor's latest — so every surface says the same. Null when
 * there is nothing to say.
 */
export function agentCliNotice(connection: AgentConnectionLike): AgentCliNotice | null {
  const report = connection.agentCli;
  if (!report) return null;
  const agent = connection.agentName ?? connection.name;
  const base = { provider: connection.name, command: report.command };
  switch (report.state) {
    case 'missing':
      return { ...base, severity: 'required', action: 'install', text: `${agent} is not installed` };
    case 'update-required':
      return {
        ...base,
        severity: 'required',
        action: 'update',
        text: `${agent} ${report.installed ?? ''}`.trim() + ` is older than Moxxy works with — update it to ${report.minimum} or newer`,
      };
    case 'update-available':
      return report.latest
        ? { ...base, severity: 'available', action: 'update', text: `${agent} ${report.latest} is out — you have ${report.installed ?? 'an older one'}` }
        : null;
    default:
      return null;
  }
}

/** {@link agentCliNotice} for the conversation's active connection. */
export function activeAgentCliNotice(
  providers: ReadonlyArray<AgentConnectionLike>,
  activeProvider: string | null | undefined,
): AgentCliNotice | null {
  const info = providers.find((p) => p.name === activeProvider);
  return info ? agentCliNotice(info) : null;
}
