import { useState } from 'react';
import { useSettings } from '@moxxy/client-core';
import { Skeleton, Icon } from '@moxxy/desktop-ui';
import { SkillsView } from './SkillsView';
import { ProvidersTab } from './ProvidersTab';
import { McpTab } from './McpTab';
import { VaultTab } from './VaultTab';
import { MobileTab } from './MobileTab';
import { PreferencesTab } from './PreferencesTab';
import { SearchBox } from './settings-primitives';
import { ViewHeader, ViewSwitcher, Segmented, type View } from '../shell/ViewHeader';

type SettingsSlice = ReturnType<typeof useSettings>;

/** Context every tab's `render` receives — the settings slice plus the shared
 *  search query so each descriptor owns its own filtering. */
interface TabContext {
  readonly s: SettingsSlice;
  readonly query: string;
  readonly setQuery: (v: string) => void;
}

/** A single source of truth for the settings tabs: its id/label, whether it
 *  reads the runner-backed slice (`standalone` = render outside the shared
 *  loading/error chrome), and how it renders. Adding a tab is one entry here —
 *  the nav, the standalone set, and per-tab filtering all derive from it. */
interface TabDescriptor {
  readonly id: string;
  readonly label: string;
  readonly standalone: boolean;
  readonly render: (ctx: TabContext) => JSX.Element;
}

function filtered<T extends { name: string }>(items: ReadonlyArray<T>, query: string): ReadonlyArray<T> {
  const q = query.trim().toLowerCase();
  return q ? items.filter((i) => i.name.toLowerCase().includes(q)) : items;
}

const TAB_DESCRIPTORS: ReadonlyArray<TabDescriptor> = [
  {
    id: 'providers',
    label: 'Providers',
    standalone: false,
    render: ({ s, query, setQuery }) => (
      <ProvidersTab
        providers={filtered(s.providers, query)}
        onToggle={s.setProviderEnabled}
        onConfigure={s.configureProvider}
        onSetKey={s.setProviderKey}
        onRefresh={s.refresh}
        search={<SearchBox value={query} onChange={setQuery} placeholder="Search providers…" />}
      />
    ),
  },
  {
    id: 'mcp',
    label: 'MCP',
    standalone: false,
    render: ({ s, query, setQuery }) => (
      <McpTab
        servers={filtered(s.mcp, query)}
        onToggle={s.toggleMcp}
        onRefresh={s.refresh}
        search={<SearchBox value={query} onChange={setQuery} placeholder="Search MCP servers…" />}
      />
    ),
  },
  {
    id: 'skills',
    label: 'Skills',
    standalone: false,
    render: ({ s }) => <SkillsView s={s} />,
  },
  {
    id: 'vault',
    label: 'Vault',
    standalone: false,
    render: ({ s, query, setQuery }) => (
      <VaultTab
        vault={filtered(s.vault, query)}
        search={<SearchBox value={query} onChange={setQuery} placeholder="Search vault…" />}
        onAdd={s.setVaultKey}
        onRemove={s.removeVaultKey}
      />
    ),
  },
  { id: 'mobile', label: 'Mobile', standalone: true, render: () => <MobileTab /> },
  { id: 'preferences', label: 'Preferences', standalone: true, render: () => <PreferencesTab /> },
];

type Tab = (typeof TAB_DESCRIPTORS)[number]['id'];

const TABS: ReadonlyArray<{ id: Tab; label: string }> = TAB_DESCRIPTORS.map(({ id, label }) => ({
  id,
  label,
}));

/**
 * Tabbed settings panel — providers, MCP servers, skills, vault. Each tab
 * reads its slice via `useSettings` and only the active tab does heavy work
 * (the IPC fan-out happens on refresh; tab switch just swaps the view).
 *
 * Providers / MCP / Vault share one list language: a leading icon tile, a
 * name + status subtitle in a flexible middle column, and a right-aligned
 * status dot / toggle / badge — so every row lines up on the same grid.
 *
 * This is the tab shell: it owns the segmented nav, the per-tab search filter,
 * and the loading / error chrome, then renders the active tab component.
 */
export function SettingsPanel({
  // Optional so the panel can render standalone (tests); the app shell
  // always wires it so the header switcher navigates.
  onView = () => undefined,
}: {
  readonly onView?: (v: View) => void;
}): JSX.Element {
  const s = useSettings();
  const [tab, setTab] = useState<Tab>('providers');
  const [query, setQuery] = useState('');

  const active = TAB_DESCRIPTORS.find((d) => d.id === tab) ?? TAB_DESCRIPTORS[0]!;
  const ctx: TabContext = { s, query, setQuery };

  return (
    <>
      <ViewHeader>
        <ViewSwitcher view="settings" onView={onView} />
        <span style={{ flex: 1 }} />
        <Segmented
          items={TABS}
          value={tab}
          onChange={(t) => {
            setTab(t);
            setQuery('');
          }}
          testIdPrefix="settings-tab-"
          collapsible
        />
      </ViewHeader>
      <div
        style={{
          flex: 1,
          minHeight: 0,
          overflowY: 'auto',
          padding: '20px 32px 40px',
          display: 'flex',
          flexDirection: 'column',
          gap: 20,
        }}
      >

      {/* Standalone tabs (Preferences / Mobile) are independent of the
          runner-backed settings slice — render them without the shared
          loading / error chrome below. */}
      {active.standalone && active.render(ctx)}

      {!active.standalone && s.error && (
        <div
          role="alert"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 9,
            margin: 0,
            padding: '10px 14px',
            border: '1px solid color-mix(in oklab, var(--color-red) 30%, transparent)',
            background: 'color-mix(in oklab, var(--color-red) 8%, transparent)',
            borderRadius: 12,
            fontSize: 13,
            color: 'var(--color-red)',
          }}
        >
          <Icon name="x" size={15} />
          {s.error}
        </div>
      )}

      {active.standalone ? null : s.loading ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <Skeleton.Card />
          <Skeleton.Card />
          <Skeleton.Card />
        </div>
      ) : (
        active.render(ctx)
      )}
      </div>
    </>
  );
}
