import { useState } from 'react';
import { assertDefined } from '@/lib/assert';
import { useSettings } from '@moxxy/client-core';
import { Skeleton, Icon } from '@moxxy/desktop-ui';
import { SkillsView } from './SkillsView';
import { ProvidersTab } from './ProvidersTab';
import { DefaultModelSetting } from './DefaultModel';
import { McpTab } from './McpTab';
import { VaultTab } from './VaultTab';
import { PreferencesTab } from './PreferencesTab';
import { VoiceTab } from './VoiceTab';
import { JevTab } from './JevTab';
import { SearchBox } from './settings-primitives';
import { InstrumentBar } from '../shell/InstrumentBar';
import { IndexColumn, IndexGroup, IndexRow } from '../shell/IndexColumn';
import { sectionsIn, type SettingsScope, type SettingsTab } from './sections';

export type { SettingsScope, SettingsTab } from './sections';

type SettingsSlice = ReturnType<typeof useSettings>;

/** Context every tab's `render` receives — the settings slice plus the shared
 *  search query so each descriptor owns its own filtering. */
interface TabContext {
  readonly s: SettingsSlice;
  readonly query: string;
  readonly setQuery: (v: string) => void;
}

/** How a section draws: whether it reads the runner-backed slice (`standalone`
 *  = render outside the shared loading/error chrome), and its pane. What the
 *  sections ARE lives in `./sections`. */
interface TabView {
  readonly standalone: boolean;
  readonly render: (ctx: TabContext) => JSX.Element;
}

function filtered<T extends { name: string }>(items: ReadonlyArray<T>, query: string): ReadonlyArray<T> {
  const q = query.trim().toLowerCase();
  return q ? items.filter((i) => i.name.toLowerCase().includes(q)) : items;
}

const TAB_VIEWS: Readonly<Record<SettingsTab, TabView>> = {
  providers: {
    standalone: false,
    render: ({ s, query, setQuery }) => (
      <ProvidersTab
        providers={filtered(s.providers, query)}
        onToggle={s.setProviderEnabled}
        onConfigure={s.configureProvider}
        onSetKey={s.setProviderKey}
        onActivate={s.activateProvider}
        onRefresh={s.refresh}
        search={<SearchBox value={query} onChange={setQuery} placeholder="Search providers…" />}
        defaultModel={<DefaultModelSetting />}
      />
    ),
  },
  mcp: {
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
  skills: { standalone: false, render: ({ s }) => <SkillsView s={s} /> },
  vault: {
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
  preferences: { standalone: true, render: () => <PreferencesTab /> },
  voice: { standalone: true, render: () => <VoiceTab /> },
  jev: { standalone: true, render: () => <JevTab /> },
};

type Group = { readonly label: string; readonly sections: ReadonlyArray<ReturnType<typeof sectionsIn>[number]> };

/**
 * A view's sections under their captions, grouped by what they are ABOUT
 * rather than listed flat: "where would I look for this" is the only question
 * a settings nav has to answer.
 */
function groupsFor(scope: SettingsScope): ReadonlyArray<Group> {
  const groups: Array<{ label: string; sections: Array<Group['sections'][number]> }> = [];
  for (const section of sectionsIn(scope)) {
    const last = groups.at(-1);
    if (last && last.label === section.group) last.sections.push(section);
    else groups.push({ label: section.group, sections: [section] });
  }
  return groups;
}

/**
 * The Settings index column: the sections, grouped.
 *
 * A caption sorts a list into groups. Where every group in view is a single
 * row there is nothing to sort, and a caption over each row reads as a second
 * row that cannot be pressed; that list is drawn flat.
 */
export function SettingsIndex({
  tab,
  onPick,
  scope = 'all',
}: {
  readonly tab: SettingsTab;
  readonly onPick: (tab: SettingsTab) => void;
  readonly scope?: SettingsScope;
}): JSX.Element | null {
  const groups = groupsFor(scope);
  const captioned = groups.some((group) => group.sections.length > 1);
  return (
    <IndexColumn title={scope === 'extensions' ? 'extensions' : 'settings'}>
      {groups.map((group) => (
        <div key={group.label}>
          {captioned && <IndexGroup label={group.label} />}
          {group.sections.map((section) => (
            <IndexRow
              key={section.id}
              label={section.label}
              icon={section.icon}
              active={section.id === tab}
              testId={`settings-tab-${section.id}`}
              onPick={() => onPick(section.id)}
            />
          ))}
        </div>
      ))}
    </IndexColumn>
  );
}

/** Which settings section is open. Owned by the shell so the index column and
 *  the pane agree, and so it survives leaving the destination and coming back. */
export function useSettingsTab(
  scope: SettingsScope = 'all',
): readonly [SettingsTab, (t: SettingsTab) => void] {
  const [tab, setTab] = useState<SettingsTab>(() => {
    const first = sectionsIn(scope)[0];
    assertDefined(first, 'every settings view lists a section');
    return first.id;
  });
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
export function SettingsPanel({
  tab,
  scope = 'all',
}: {
  readonly tab: SettingsTab;
  readonly scope?: SettingsScope;
}): JSX.Element {
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

  const section = sectionsIn('all').find((candidate) => candidate.id === tab);
  assertDefined(section, 'the open tab is a settings section');
  const active = { label: section.label, ...TAB_VIEWS[tab] };
  const ctx: TabContext = { s, query, setQuery };

  return (
    <>
      <InstrumentBar crumbs={[scope === 'extensions' ? 'Extensions' : 'Settings', active.label]} />
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
