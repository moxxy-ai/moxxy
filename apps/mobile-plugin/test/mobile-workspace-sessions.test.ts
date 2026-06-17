import { describe, expect, it } from 'vitest';
import type { Desk } from '@moxxy/desktop-ipc-contract';

import { buildMobileWorkspaceSessionRecords } from '../mobile/src/mobileWorkspaceSessions';

describe('mobile workspace session records', () => {
  it('mirrors the desktop desks overview exactly and marks the active session', () => {
    const desks: Desk[] = [
      {
        id: 'desk-tata',
        name: 'Tata',
        cwd: '/Users/kamil/Tata',
        color: '#ef4444',
        createdAt: 1,
        activeSessionId: 'session-czesc',
        sessions: [
          {
            id: 'session-007',
            name: 'znasz grę 007 first light ?',
            firstPrompt: 'znasz grę 007 first light ?',
            cwd: '/Users/kamil/Tata',
            createdAt: 1,
            eventCount: 5,
            lastActivity: '2026-06-17T18:00:00.000Z',
          },
          {
            id: 'session-czesc',
            name: 'cześć',
            firstPrompt: 'cześć',
            cwd: '/Users/kamil/Tata',
            createdAt: 2,
            eventCount: 3,
            lastActivity: '2026-06-17T19:00:00.000Z',
          },
          {
            id: 'session-realtime',
            name: 'Realtime permission QA',
            firstPrompt: 'uzyj computer_open i otworz https://example.org test permission realtime',
            cwd: '/Users/kamil/Tata',
            createdAt: 3,
            eventCount: 7,
            lastActivity: '2026-06-17T20:00:00.000Z',
          },
        ],
      },
    ];

    const records = buildMobileWorkspaceSessionRecords({
      desks,
      activeSessionId: 'session-czesc',
      connected: true,
    });

    expect(records.map((record) => [record.id, record.name, record.firstPrompt])).toEqual([
      ['session-007', 'znasz grę 007 first light ?', 'znasz grę 007 first light ?'],
      ['session-czesc', 'cześć', 'cześć'],
      ['session-realtime', 'Realtime permission QA', 'Realtime permission QA'],
    ]);
    expect(records.find((record) => record.id === 'session-czesc')).toMatchObject({
      workspaceId: 'desk-tata',
      live: true,
      readOnly: false,
    });
    expect(records.find((record) => record.id === 'session-007')).toMatchObject({
      live: false,
      readOnly: false,
    });
  });
});
