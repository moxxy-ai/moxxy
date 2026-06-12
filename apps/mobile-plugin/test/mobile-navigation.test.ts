import { describe, expect, it } from 'vitest';
import {
  buildBottomTabs,
  buildComposerAttachmentActionItems,
  applyWorkspaceCollapseToggles,
  buildMobileMenuItems,
  buildInitialCollapsedWorkspaceIds,
  buildQuickActionItems,
  buildRecentMenuSessions,
  buildReturnToChatAction,
  buildWorkspaceMenuSections,
  filterRecentMenuSessions,
  filterWorkspaceMenuSections,
} from '../mobile/src/navigation';
import { shouldLoadOlderFromScroll } from '../mobile/src/chatListState';
import { buildChatListAutoScrollKey } from '../mobile/src/hooks/useChatListAutoScroll';

describe('mobile bottom navigation model', () => {
  it('keeps the mobile tab bar compact, icon-led, and badge-aware', () => {
    const tabs = buildBottomTabs(3);

    expect(tabs).toHaveLength(5);
    expect(tabs.map((tab) => tab.label)).toEqual(['Chat', 'Sessions', 'Actions', 'Goals', 'Settings']);
    expect(tabs.map((tab) => tab.href)).toEqual(['/chat', '/sessions', '/permissions', '/goals', '/settings']);
    expect(tabs.map((tab) => tab.icon)).toEqual(['message', 'sessions', 'actions', 'goals', 'settings']);
    expect(tabs.find((tab) => tab.label === 'Actions')).toMatchObject({ badge: '3' });
  });

  it('does not render an empty actions badge', () => {
    expect(buildBottomTabs(0).find((tab) => tab.label === 'Actions')?.badge).toBeNull();
  });
});

describe('mobile chat chrome navigation model', () => {
  it('keeps hamburger menu focused on full-screen app areas, not composer actions', () => {
    const items = buildMobileMenuItems(2);

    expect(items.map((item) => item.label)).toEqual(['Workflows', 'Settings', 'Gateway']);
    expect(items.map((item) => item.icon)).toEqual(['workflows', 'settings', 'gateway']);
    expect(items.map((item) => item.kind)).toEqual(['link', 'link', 'link']);
    expect(items.find((item) => item.label === 'Workflows')).toMatchObject({ href: '/workflows' });
    expect(items.map((item) => item.href)).not.toContain('/sessions');
    expect(items.map((item) => item.label)).not.toContain('Sessions');
    expect(items.map((item) => item.label)).not.toContain('Actions');
    expect(items.map((item) => item.label)).not.toContain('Goals');
  });

  it('keeps the composer plus menu focused on runtime actions', () => {
    const items = buildQuickActionItems(true);

    expect(items.map((item) => item.id)).toEqual(['goal', 'autoApprove', 'compact', 'newSession']);
    expect(items.map((item) => item.icon)).toEqual(['goals', 'bolt', 'actions', 'plus']);
    expect(items.find((item) => item.id === 'autoApprove')).toMatchObject({
      active: true,
      label: 'Auto-approve ON',
    });
    expect(items.find((item) => item.id === 'compact')).toMatchObject({
      id: 'compact',
      label: 'Compact context',
      requiresConfirmation: true,
    });
  });

  it('keeps composer attachment actions short and leaves image paste to the input paste flow', () => {
    const items = buildComposerAttachmentActionItems();

    expect(items.map((item) => item.id)).toEqual(['attachImage', 'attachFile']);
    expect(items.map((item) => item.label)).toEqual(['Photo or screenshot', 'File from phone']);
    expect(items.map((item) => item.label)).not.toContain('Paste image');
  });

  it('builds a compact recent-session list for the full-screen hamburger menu', () => {
    const sessions = buildRecentMenuSessions([
      { id: 'live', name: 'new_moxxy', cwd: '/repo', eventCount: 0, live: true, readOnly: false },
      { id: 'old-1', firstPrompt: 'Odpowiedz jednym słowem: OK', cwd: '/repo', eventCount: 12, live: false, readOnly: true },
      { id: 'empty', name: 'new_moxxy', cwd: '/repo', eventCount: 0, live: false, readOnly: true },
      { id: 'old-2', firstPrompt: 'Plan żywieniowy na dzień', cwd: '/diet', eventCount: 250, live: false, readOnly: true },
    ], 'live', 2);

    expect(sessions).toEqual([
      expect.objectContaining({ id: 'live', title: 'new_moxxy', active: true, live: true, statusLabel: 'Active' }),
      expect.objectContaining({ id: 'old-1', title: 'Odpowiedz jednym słowem: OK', active: false, live: false, statusLabel: null }),
    ]);
    expect(sessions.map((session) => session.id)).not.toContain('empty');
  });

  it('does not double-label live sessions in the hamburger menu', () => {
    const sessions = buildRecentMenuSessions([
      { id: 'live', name: 'new_moxxy', cwd: '/repo', eventCount: 0, live: true, readOnly: false },
      { id: 'hydrated', firstPrompt: 'Hydrated session', cwd: '/repo', eventCount: 42, live: true, readOnly: false },
    ], 'hydrated');

    expect(sessions).toEqual([
      expect.objectContaining({ id: 'live', dotTone: 'muted', statusLabel: null }),
      expect.objectContaining({ id: 'hydrated', dotTone: 'active', statusLabel: 'Active' }),
    ]);
  });

  it('filters recent sessions by title and workspace path', () => {
    const sessions = buildRecentMenuSessions([
      { id: 'diet', firstPrompt: 'Plan żywieniowy na dzień', cwd: '/Users/kamil/diet', eventCount: 20 },
      { id: 'car', firstPrompt: 'BYD Sealion hotspot', cwd: '/Users/kamil/cars', eventCount: 8 },
      { id: 'codex', firstPrompt: 'Moxxy mobile gateway', cwd: '/Users/kamil/new_moxxy', eventCount: 32 },
    ], null);

    expect(filterRecentMenuSessions(sessions, 'byd').map((session) => session.id)).toEqual(['car']);
    expect(filterRecentMenuSessions(sessions, 'new_moxxy').map((session) => session.id)).toEqual(['codex']);
    expect(filterRecentMenuSessions(sessions, '  ').map((session) => session.id)).toEqual(['diet', 'car', 'codex']);
  });

  it('lets the hamburger menu render every visible session when no limit is supplied', () => {
    const sessions = Array.from({ length: 18 }, (_, index) => ({
      id: `session-${index}`,
      firstPrompt: `Prompt ${index}`,
      cwd: '/repo',
      eventCount: index + 1,
      live: false,
      readOnly: true,
    }));

    expect(buildRecentMenuSessions(sessions, null)).toHaveLength(18);
  });

  it('groups hamburger menu sessions under real desktop workspaces and puts unmatched sessions in Others', () => {
    const sections = buildWorkspaceMenuSections([
      {
        id: 'desk-moxxy',
        name: 'moxxy workspace',
        cwd: '/Users/kamil/Downloads/moxxy workspace',
        color: '#3b82f6',
      },
      {
        id: 'desk-tata',
        name: 'Tata',
        cwd: '/Users/kamil/Downloads/Tata',
        color: '#ef4444',
      },
    ], [
      {
        id: 'older',
        firstPrompt: 'Przeanalizuj aplikację',
        cwd: '/Users/kamil/Downloads/Tata',
        eventCount: 10,
        lastActivity: '2026-06-08T08:00:00.000Z',
      },
      {
        id: 'active',
        firstPrompt: 'Przeanalizuj strukturę aplikacji',
        cwd: '/Users/kamil/Downloads/moxxy workspace',
        eventCount: 40,
        lastActivity: '2026-06-09T07:00:00.000Z',
      },
      {
        id: 'unmatched',
        firstPrompt: 'Stwórz viralowy film 9:16',
        cwd: '/Users/kamil/new_moxxy',
        eventCount: 12,
        lastActivity: '2026-06-08T19:00:00.000Z',
      },
    ], 'active');

    expect(sections).toEqual([
      expect.objectContaining({
        id: 'desk-moxxy',
        title: 'moxxy workspace',
        color: '#3b82f6',
        active: true,
        sessions: [
          expect.objectContaining({ id: 'active', active: true, shortcutLabel: null }),
        ],
      }),
      expect.objectContaining({
        id: 'desk-tata',
        title: 'Tata',
        active: false,
        sessions: [
          expect.objectContaining({ id: 'older', shortcutLabel: null }),
        ],
      }),
      expect.objectContaining({
        id: 'others',
        title: 'Others',
        active: false,
        sessions: [
          expect.objectContaining({ id: 'unmatched', shortcutLabel: null }),
        ],
      }),
    ]);
    expect(sections.map((section) => section.title)).not.toContain('new_moxxy');
  });

  it('keeps registry sessions visible even when they are inactive and not live', () => {
    const sections = buildWorkspaceMenuSections([
      {
        id: 'moxxy',
        name: 'Moxxy',
        cwd: '/Users/kamil/.moxxy/workspaces/moxxy',
        color: '#ec4899',
      },
    ], [
      {
        id: 'persisted-session',
        workspaceId: 'moxxy',
        name: 'Existing desktop session',
        cwd: '/Users/kamil/project',
        live: false,
        readOnly: false,
      },
    ], null);

    expect(sections).toHaveLength(1);
    expect(sections[0]!.sessions.map((session) => session.id)).toEqual(['persisted-session']);
  });

  it('filters workspace menu sections by workspace title, path, and session title', () => {
    const sections = buildWorkspaceMenuSections([
      {
        id: 'desk-tata',
        name: 'Tata',
        cwd: '/Users/kamil/Downloads/Tata',
        color: '#ef4444',
      },
    ], [
      { id: 'diet', firstPrompt: 'Plan żywieniowy na dzień', cwd: '/Users/kamil/feed-the-beast', eventCount: 20 },
      { id: 'tata', firstPrompt: 'Syrop z kwiatów czarnego bzu', cwd: '/Users/kamil/Downloads/Tata', eventCount: 32 },
    ], null);

    expect(filterWorkspaceMenuSections(sections, 'feed').map((section) => section.id)).toEqual(['others']);
    expect(filterWorkspaceMenuSections(sections, 'Tata').map((section) => section.sessions.map((session) => session.id))).toEqual([
      ['tata'],
    ]);
    expect(filterWorkspaceMenuSections(sections, '  ').flatMap((section) => section.sessions.map((session) => session.id))).toEqual([
      'tata',
      'diet',
    ]);
  });

  it('collapses overflow workspace sections while keeping the active workspace visible', () => {
    const sections = Array.from({ length: 6 }, (_, index) => ({
      id: `workspace-${index + 1}`,
      title: `Workspace ${index + 1}`,
      subtitle: `/workspace-${index + 1}`,
      color: '#ec4899',
      active: index === 4,
      latestActivity: `2026-06-09T0${index}:00:00.000Z`,
      sessions: [
        {
          id: `session-${index + 1}`,
          title: `Session ${index + 1}`,
          subtitle: `/workspace-${index + 1}`,
          active: index === 4,
          live: index === 4,
          readOnly: false,
          lastActivity: `2026-06-09T0${index}:00:00.000Z`,
          shortcutLabel: null,
        },
      ],
    }));

    expect(buildInitialCollapsedWorkspaceIds(sections, 3)).toEqual(['workspace-3', 'workspace-4', 'workspace-6']);
  });

  it('collapses workspace sections with too many sessions even when the workspace list is short', () => {
    const sections = [
      workspaceSection('moxxy', 8, false),
      workspaceSection('tata', 1, false),
      workspaceSection('others', 75, false),
      workspaceSection('active-heavy', 80, true),
    ];

    expect(buildInitialCollapsedWorkspaceIds(sections, 4)).toEqual(['others', 'active-heavy']);
  });

  it('keeps manual workspace collapse changes as toggles over the latest defaults', () => {
    expect(applyWorkspaceCollapseToggles(['others', 'archive'], ['others', 'tata'])).toEqual([
      'archive',
      'tata',
    ]);
  });
});

describe('mobile chat list paging model', () => {
  it('requests older history only when the user scrolls near the top and history exists', () => {
    expect(shouldLoadOlderFromScroll({ contentOffsetY: 0, hasOlder: true })).toBe(true);
    expect(shouldLoadOlderFromScroll({ contentOffsetY: 18, hasOlder: true })).toBe(true);
    expect(shouldLoadOlderFromScroll({ contentOffsetY: 64, hasOlder: true })).toBe(false);
    expect(shouldLoadOlderFromScroll({ contentOffsetY: 0, hasOlder: false })).toBe(false);
  });

  it('does not treat prepended older messages as new bottom content', () => {
    const newest = { id: 'newest', kind: 'assistant' as const, label: 'Assistant' as const, text: 'tail', streaming: false };

    expect(buildChatListAutoScrollKey([newest], false)).toBe(
      buildChatListAutoScrollKey([
        { id: 'older', kind: 'user' as const, text: 'older' },
        newest,
      ], false),
    );
  });
});

function workspaceSection(id: string, sessionCount: number, active: boolean) {
  return {
    id,
    title: id,
    subtitle: `/${id}`,
    color: '#ec4899',
    active,
    latestActivity: '2026-06-09T09:00:00.000Z',
    sessions: Array.from({ length: sessionCount }, (_, index) => ({
      id: `${id}-${index}`,
      title: `${id} ${index}`,
      subtitle: `/${id}`,
      active: false,
      live: false,
      readOnly: true,
      lastActivity: '2026-06-09T09:00:00.000Z',
      shortcutLabel: null,
    })),
  };
}

describe('mobile auxiliary screen navigation', () => {
  it('keeps a direct escape hatch back to chat from non-chat screens', () => {
    expect(buildReturnToChatAction()).toEqual({
      href: '/chat',
      label: 'Chat',
      icon: 'message',
    });
  });
});
