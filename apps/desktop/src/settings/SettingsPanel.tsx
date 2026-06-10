import { useState } from 'react';
import { useSettings } from '@moxxy/client-core';
import { Skeleton, Icon } from '@moxxy/desktop-ui';
import { SkillsView } from './SkillsView';
import { ProvidersTab } from './ProvidersTab';
import { McpTab } from './McpTab';
import { VaultTab } from './VaultTab';
import { AboutTab } from './AboutTab';
import { MobileTab } from './MobileTab';
import { SearchBox } from './settings-primitives';
import { ViewHeader, ViewSwitcher, Segmented, type View } from '../shell/ViewHeader';

type Tab = 'providers' | 'mcp' | 'skills' | 'vault' | 'mobile' | 'about';

const TABS: ReadonlyArray<{ id: Tab; label: string }> = [
  { id: 'providers', label: 'Providers' },
  { id: 'mcp', label: 'MCP' },
  { id: 'skills', label: 'Skills' },
  { id: 'vault', label: 'Vault' },
  { id: 'mobile', label: 'Mobile' },
  { id: 'about', label: 'About' },
];

// Tabs that don't read the runner-backed settings slice — render them outside
// the shared loading / error chrome (like About).
const STANDALONE_TABS: ReadonlySet<Tab> = new Set<Tab>(['about', 'mobile']);

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
  const q = query.trim().toLowerCase();

  const providers = q ? s.providers.filter((p) => p.name.toLowerCase().includes(q)) : s.providers;
  const mcp = q ? s.mcp.filter((m) => m.name.toLowerCase().includes(q)) : s.mcp;
  const vault = q ? s.vault.filter((v) => v.name.toLowerCase().includes(q)) : s.vault;

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

      {/* About + Mobile are independent of the runner-backed settings slice —
          render them without the shared loading / error chrome below. */}
      {tab === 'about' && <AboutTab />}
      {tab === 'mobile' && <MobileTab />}

      {!STANDALONE_TABS.has(tab) && s.error && (
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

      {STANDALONE_TABS.has(tab) ? null : s.loading ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <Skeleton.Card />
          <Skeleton.Card />
          <Skeleton.Card />
        </div>
      ) : (
        <>
          {tab === 'providers' && (
            <ProvidersTab
              providers={providers}
              onRefresh={s.refresh}
              search={<SearchBox value={query} onChange={setQuery} placeholder="Search providers…" />}
            />
          )}
          {tab === 'mcp' && (
            <McpTab
              servers={mcp}
              onToggle={s.toggleMcp}
              onRefresh={s.refresh}
              search={<SearchBox value={query} onChange={setQuery} placeholder="Search MCP servers…" />}
            />
          )}
          {tab === 'skills' && <SkillsView s={s} />}
          {tab === 'vault' && (
            <VaultTab
              vault={vault}
              search={<SearchBox value={query} onChange={setQuery} placeholder="Search vault…" />}
              onAdd={s.setVaultKey}
              onRemove={s.removeVaultKey}
            />
          )}
        </>
      )}
      </div>
    </>
  );
}
