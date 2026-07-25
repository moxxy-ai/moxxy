import type {
  NativeBrowserSnapshot,
  NativeBrowserTabSnapshot,
} from '@moxxy/desktop-ipc-contract';

export interface PersistedNativeBrowserTab {
  readonly id: string;
  readonly url: string;
}

export interface PersistedNativeBrowserWorkspace {
  readonly workspaceId: string;
  readonly activeTabId: string;
  readonly tabs: ReadonlyArray<PersistedNativeBrowserTab>;
}

interface MutableTab {
  id: string;
  title: string;
  url: string;
  loading: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
  zoom: number;
}

interface MutableWorkspace {
  readonly workspaceId: string;
  tabs: MutableTab[];
  activeTabId: string;
  visible: boolean;
}

const BLANK_URL = 'about:blank';
const MAX_TABS_PER_WORKSPACE = 64;

export class NativeBrowserState {
  private readonly workspaces = new Map<string, MutableWorkspace>();

  constructor(private readonly createId: () => string) {}

  ensureWorkspace(workspaceId: string): NativeBrowserSnapshot {
    if (!this.workspaces.has(workspaceId)) {
      const tab = this.createTab(BLANK_URL);
      this.workspaces.set(workspaceId, {
        workspaceId,
        tabs: [tab],
        activeTabId: tab.id,
        visible: false,
      });
    }
    return this.snapshot(workspaceId);
  }

  snapshot(workspaceId: string): NativeBrowserSnapshot {
    const workspace = this.mustWorkspace(workspaceId);
    return {
      backend: 'native',
      workspaceId,
      tabs: workspace.tabs.map((tab) => ({ ...tab })),
      activeTabId: workspace.activeTabId,
      visible: workspace.visible,
    };
  }

  newTab(workspaceId: string, url = BLANK_URL): NativeBrowserTabSnapshot {
    this.ensureWorkspace(workspaceId);
    const workspace = this.mustWorkspace(workspaceId);
    if (workspace.tabs.length >= MAX_TABS_PER_WORKSPACE) {
      throw new Error(`native browser supports a maximum of ${MAX_TABS_PER_WORKSPACE} tabs per workspace`);
    }
    const tab = this.createTab(url);
    workspace.tabs.push(tab);
    workspace.activeTabId = tab.id;
    return { ...tab };
  }

  selectTab(workspaceId: string, tabId: string): void {
    const workspace = this.mustWorkspace(workspaceId);
    this.mustTab(workspace, tabId);
    workspace.activeTabId = tabId;
  }

  closeTab(workspaceId: string, tabId: string): void {
    const workspace = this.mustWorkspace(workspaceId);
    const index = workspace.tabs.findIndex((tab) => tab.id === tabId);
    if (index < 0) throw new Error(`unknown native browser tab: ${tabId}`);
    workspace.tabs.splice(index, 1);
    if (workspace.tabs.length === 0) workspace.tabs.push(this.createTab(BLANK_URL));
    if (workspace.activeTabId === tabId) {
      workspace.activeTabId = workspace.tabs[Math.min(index, workspace.tabs.length - 1)]?.id ?? '';
    }
  }

  resolveOperationTarget(workspaceId: string, tabId?: string): NativeBrowserTabSnapshot {
    const workspace = this.mustWorkspace(workspaceId);
    const tab = this.mustTab(workspace, tabId ?? workspace.activeTabId);
    return { ...tab };
  }

  updateTab(
    workspaceId: string,
    tabId: string,
    patch: Partial<Omit<NativeBrowserTabSnapshot, 'id'>>,
  ): void {
    const tab = this.mustTab(this.mustWorkspace(workspaceId), tabId);
    Object.assign(tab, patch);
  }

  setVisible(workspaceId: string, visible: boolean): void {
    this.mustWorkspace(workspaceId).visible = visible;
  }

  restore(workspaces: ReadonlyArray<PersistedNativeBrowserWorkspace>): void {
    for (const persisted of workspaces) {
      if (persisted.tabs.length === 0) continue;
      const tabs = persisted.tabs.map((tab) => this.createTab(tab.url, tab.id));
      const activeTabId = tabs.some((tab) => tab.id === persisted.activeTabId)
        ? persisted.activeTabId
        : tabs[0]?.id;
      if (!activeTabId) continue;
      this.workspaces.set(persisted.workspaceId, {
        workspaceId: persisted.workspaceId,
        tabs,
        activeTabId,
        visible: false,
      });
    }
  }

  serialize(): ReadonlyArray<PersistedNativeBrowserWorkspace> {
    return Array.from(this.workspaces.values(), (workspace) => ({
      workspaceId: workspace.workspaceId,
      activeTabId: workspace.activeTabId,
      tabs: workspace.tabs.map(({ id, url }) => ({ id, url })),
    }));
  }

  private createTab(url: string, id = this.createId()): MutableTab {
    return {
      id,
      title: url === BLANK_URL ? 'New tab' : url,
      url,
      loading: false,
      canGoBack: false,
      canGoForward: false,
      zoom: 1,
    };
  }

  private mustWorkspace(workspaceId: string): MutableWorkspace {
    const workspace = this.workspaces.get(workspaceId);
    if (!workspace) throw new Error(`unknown native browser workspace: ${workspaceId}`);
    return workspace;
  }

  private mustTab(workspace: MutableWorkspace, tabId: string): MutableTab {
    const tab = workspace.tabs.find((candidate) => candidate.id === tabId);
    if (!tab) throw new Error(`unknown native browser tab: ${tabId}`);
    return tab;
  }
}
