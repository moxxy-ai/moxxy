import { useState } from 'react';
import { assertDefined } from '@/lib/assert';
import { useSettings } from '@moxxy/client-core';
import { Skeleton, Icon } from '@moxxy/desktop-ui';
import { SkillsView } from './SkillsView';
import { ProvidersTab } from './ProvidersTab';
import { McpTab } from './McpTab';
import { VaultTab } from './VaultTab';
import { PreferencesTab } from './PreferencesTab';
import { SearchBox } from './settings-primitives';
import { InstrumentBar } from '../shell/InstrumentBar';
import { IndexColumn } from '../shell/IndexColumn';

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
  { id: 'preferences', label: 'Preferences', standalone: true, render: () => <PreferencesTab /> },
];

type Tab = (typeof TAB_DESCRIPTORS)[number]['id'];

const TABS: ReadonlyArray<{ id: Tab; label: string }> = TAB_DESCRIPTORS.map(({ id, label }) => ({
  id,
  label,
}));

/**
 * Settings sections, grouped by what they are ABOUT rather than listed flat.
 *
 * A flat row of chips gave "Vault" and "Skills" the same standing, when one is a
 * secret store and the other a capability — the grouping is the answer to "where
 * would I look for this", which is the only question a settings nav has to
 * answer.
 */
const GROUPS: ReadonlyArray<{ readonly label: string; readonly ids: ReadonlyArray<Tab> }> = [
  { label: 'agent', ids: ['providers'] },
  { label: 'extend', ids: ['mcp', 'skills'] },
  { label: 'trust', ids: ['vault'] },
  { label: 'app', ids: ['preferences'] },
];

/** The Settings index column: the sections, grouped. */
export function SettingsIndex({
  tab,
  onPick,
}: {
  readonly tab: Tab;
  readonly onPick: (tab: Tab) => void;
}): JSX.Element | null {
  return (
    <IndexColumn title="settings">
      {GROUPS.map((group) => (
        <div key={group.label}>
          <div className="index-group">
            <span className="index-group__label">{group.label}</span>
          </div>
          {group.ids.map((id) => {
            const label = TABS.find((t) => t.id === id)?.label ?? id;
            const active = id === tab;
            return (
              <button
                key={id}
                type="button"
                className={active ? 'session-row' : 'session-row row-button'}
                data-testid={`settings-tab-${id}`}
                data-active={active}
                aria-current={active ? 'true' : undefined}
                onClick={() => onPick(id)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  width: '100%',
                  minHeight: 'var(--frame-row)',
                  padding: '2px var(--space-6) 2px var(--space-8)',
                  borderRadius: 'var(--radius-block)',
                  background: active ? 'var(--color-card-bg)' : 'transparent',
                  color: active
                    ? 'var(--color-sidebar-text)'
                    : 'var(--color-sidebar-text-dim)',
                  fontWeight: active ? 600 : 400,
                  fontSize: 'var(--type-row)',
                  textAlign: 'left',
                }}
              >
                {label}
              </button>
            );
          })}
        </div>
      ))}
    </IndexColumn>
  );
}

/** Which settings section is open. Owned by the shell so the index column and
 *  the pane agree, and so it survives leaving the destination and coming back. */
export function useSettingsTab(): readonly [Tab, (t: Tab) => void] {
  const [tab, setTab] = useState<Tab>('providers');
  return [tab, setTab];
}

/**
 * Settings — providers, MCP servers, skills, vault, preferences. Each section
 * reads its slice via `useSettings` and only the active one does heavy work (the
 * IPC fan-out happens on refresh; switching just swaps the view).
 *
 * Providers / MCP / Vault share one list language: a leading icon tile, a name +
 * status subtitle in a flexible middle column, and a right-aligned status dot /
 * toggle / badge — so every row lines up on the same grid.
 *
 * The section is chosen in the INDEX COLUMN now, not from a segmented row in the
 * header: a settings nav that collapses into a dropdown on a narrow window is a
 * nav that hides itself exactly when there is least room to explore.
 */
export function SettingsPanel({ tab }: { readonly tab: Tab }): JSX.Element {
  const s = useSettings();
  const [query, setQuery] = useState('');
  // Clearing the filter used to ride on the segmented control's onChange, which
  // no longer exists; without this a query typed in Providers silently filters
  // Skills the moment you switch. Keyed on the section so it fires exactly once
  // per change, with no effect.
  const [queryTab, setQueryTab] = useState(tab);
  if (queryTab !== tab) {
    setQueryTab(tab);
    setQuery('');
  }

  const firstTab = TAB_DESCRIPTORS[0];
  assertDefined(firstTab, 'TAB_DESCRIPTORS is a non-empty constant list');
  const active = TAB_DESCRIPTORS.find((d) => d.id === tab) ?? firstTab;
  const ctx: TabContext = { s, query, setQuery };

  return (
    <>
      <InstrumentBar crumbs={['Settings', active.label]} />
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

      {/* Standalone tabs (Preferences) are independent of the runner-backed
          settings slice — render them without the shared loading / error
          chrome below. */}
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
            borderRadius: 'var(--radius-card)',
            fontSize: 'var(--type-ui)',
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
