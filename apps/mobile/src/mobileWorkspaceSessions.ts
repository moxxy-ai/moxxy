import { selectedSessionReadOnly } from './mobileSessionSelection';

interface MobileDeskSession {
  readonly id: string;
  readonly name: string;
  readonly firstPrompt?: string | null;
  readonly cwd?: string | null;
  readonly eventCount?: number | null;
  readonly provider?: string | null;
  readonly model?: string | null;
  readonly lastActivity?: string | null;
  readonly createdAt: number;
}

interface MobileDesk {
  readonly id: string;
  readonly cwd: string;
  readonly sessions: ReadonlyArray<MobileDeskSession>;
}

interface BuildMobileWorkspaceSessionRecordsInput {
  readonly desks: ReadonlyArray<MobileDesk>;
  readonly activeSessionId: string | null;
  readonly connected: boolean;
}

export function buildMobileWorkspaceSessionRecords({
  desks,
  activeSessionId,
  connected,
}: BuildMobileWorkspaceSessionRecordsInput): Array<Record<string, unknown>> {
  return desks.flatMap((desk) =>
    desk.sessions.map((session) => ({
      id: session.id,
      workspaceId: desk.id,
      name: session.name,
      firstPrompt: session.name,
      cwd: session.cwd ?? desk.cwd,
      eventCount: session.eventCount ?? 0,
      provider: session.provider ?? null,
      model: session.model ?? null,
      live: session.id === activeSessionId && connected,
      readOnly: selectedSessionReadOnly({
        sessionId: session.id,
        activeWorkspaceId: activeSessionId,
        connected,
      }),
      lastActivity:
        session.lastActivity ??
        (session.createdAt > 0 ? new Date(session.createdAt).toISOString() : ''),
    })),
  );
}
