/**
 * MCP servers tab — Model Context Protocol servers the runner knows about.
 * Each Row's Switch reflects the LIVE attach state (`connected`), not the
 * persisted `enabled` flag, so toggling on enables+attaches and off detaches.
 * "Add server" opens the shared agent-task modal: the user describes the
 * server, moxxy tests + registers it in a hidden background turn.
 */

import { useState } from 'react';
import { Button, Icon } from '@moxxy/desktop-ui';
import { Section, CardList, Row, Tile, Switch, EmptyState } from './settings-primitives';
import { AgentTaskModal } from './shared/AgentTaskModal';
import { MCP_PROMPT_TEMPLATE } from './mcp-prompt';

export function McpTab({
  servers,
  onToggle,
  onRefresh,
  search,
}: {
  readonly servers: ReadonlyArray<{ name: string; enabled: boolean; connected: boolean }>;
  readonly onToggle: (name: string, enabled: boolean) => Promise<void>;
  readonly onRefresh: () => Promise<void>;
  readonly search?: React.ReactNode;
}): JSX.Element {
  const [adding, setAdding] = useState(false);
  return (
    <Section
      title="MCP servers"
      count={servers.length}
      description="Model Context Protocol servers. Toggle one on to attach its tools to the agent."
      search={search}
      actions={
        <Button variant="cta" onClick={() => setAdding(true)} style={{ gap: 7 }}>
          <Icon name="plus" size={14} />
          Add server
        </Button>
      }
    >
      {servers.length === 0 ? (
        <EmptyState icon="plug" text="No MCP servers configured." />
      ) : (
        <CardList>
          {servers.map((srv) => (
            <Row
              key={srv.name}
              testId={`mcp-row-${srv.name}`}
              tile={
                <Tile bg="var(--color-primary-soft)" fg="var(--color-primary-strong)">
                  <Icon name="plug" size={18} />
                </Tile>
              }
              title={srv.name}
              subtitle={
                srv.connected
                  ? 'Connected · tools attached'
                  : srv.enabled
                    ? 'Enabled · not attached'
                    : 'Detached'
              }
              trailing={
                // The toggle reflects the LIVE attach state, not the persisted
                // `enabled` flag: detach only clears `connected`, so a switch
                // bound to `enabled` would stay on after disabling. On →
                // enableAndAttach, off → detach.
                <Switch
                  on={srv.connected}
                  label={`${srv.connected ? 'Disable' : 'Enable'} ${srv.name}`}
                  onClick={() => void onToggle(srv.name, !srv.connected)}
                />
              }
            />
          ))}
        </CardList>
      )}
      {adding && (
        <AgentTaskModal
          title="Add MCP server"
          label="Describe the server"
          placeholder="e.g. The official GitHub MCP server from npm, using my GITHUB_TOKEN for auth."
          hint="Moxxy sets it up in the background — it tests connectivity, keeps any secret in the vault, then registers the server."
          buildPrompt={MCP_PROMPT_TEMPLATE}
          onComplete={onRefresh}
          doneLabel="Done"
          onClose={() => setAdding(false)}
        />
      )}
    </Section>
  );
}
