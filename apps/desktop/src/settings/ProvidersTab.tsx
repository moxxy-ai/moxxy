/**
 * Providers tab — the model providers the connected runner can route to. Each
 * provider is a Row with a deterministic colour-tinted initial Tile and a
 * ready/inactive StatusDot; add a provider's key in the vault to activate it.
 * "Add provider" opens the shared agent-task modal: the user names the
 * vendor, moxxy registers it in a hidden background turn.
 */

import { useState } from 'react';
import type { useSettings } from '@moxxy/client-core';
import { Button, Icon } from '@moxxy/desktop-ui';
import { Section, CardList, Row, Tile, StatusDot, EmptyState } from './settings-primitives';
import { AgentTaskModal } from './shared/AgentTaskModal';
import { PROVIDER_PROMPT_TEMPLATE } from './provider-prompt';

export function ProvidersTab({
  providers,
  onRefresh,
  search,
}: {
  readonly providers: ReturnType<typeof useSettings>['providers'];
  readonly onRefresh: () => Promise<void>;
  readonly search?: React.ReactNode;
}): JSX.Element {
  const [adding, setAdding] = useState(false);
  return (
    <Section
      title="Providers"
      count={providers.length}
      description="Model providers the runner can route to. Add a provider's key in the vault to activate it."
      search={search}
      actions={
        <Button variant="cta" onClick={() => setAdding(true)} style={{ gap: 7 }}>
          <Icon name="plus" size={14} />
          Add provider
        </Button>
      }
    >
      {providers.length === 0 ? (
        <EmptyState icon="spark" text="No providers known to the connected runner." />
      ) : (
        <CardList>
          {providers.map((p) => {
            const { bg, fg } = tintFor(p.name);
            return (
              <Row
                key={p.name}
                tile={
                  <Tile bg={bg} fg={fg}>
                    {p.name.slice(0, 1).toUpperCase()}
                  </Tile>
                }
                title={p.name}
                subtitle={p.ready ? 'Active · credentials resolved' : 'Inactive · add a key to use'}
                trailing={<StatusDot ok={p.ready} okLabel="Ready" offLabel="Inactive" />}
              />
            );
          })}
        </CardList>
      )}
      {adding && (
        <AgentTaskModal
          title="Add provider"
          label="Describe the provider"
          placeholder="e.g. DeepSeek — I'll add the API key to the vault afterwards."
          hint="Moxxy registers the provider in the background with the vendor's well-known defaults. Your API key stays in the vault."
          buildPrompt={PROVIDER_PROMPT_TEMPLATE}
          onComplete={onRefresh}
          doneLabel="Done"
          onClose={() => setAdding(false)}
        />
      )}
    </Section>
  );
}

/** Deterministic soft tint per provider name, so each tile is distinct
 *  but on-brand (pastel bg, saturated fg from the same hue). */
function tintFor(name: string): { bg: string; fg: string } {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % 360;
  return { bg: `hsl(${h} 72% 95%)`, fg: `hsl(${h} 55% 42%)` };
}
