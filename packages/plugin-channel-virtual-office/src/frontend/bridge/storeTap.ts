/**
 * Live mode: connect to the channel's WS bridge and translate moxxy traffic
 * into {@link DirectorInput}s for the game, plus roster/connection state for
 * the React HUD. The chat panel uses `@moxxy/client-core` hooks over the SAME
 * transport (configureTransport below); the game itself taps the raw
 * `runner.event` stream because it needs the granular signals (chunk deltas,
 * tool names, subagent subtypes) that the folded chat snapshots smooth away.
 *
 * There is no "ask answered" broadcast on the wire — an ask is considered
 * cleared when its workspace makes any further progress (tool events, more
 * assistant output, or the turn completing).
 */

import { makeWsApi } from '@moxxy/client-transport-ws';
import { configureTransport } from '@moxxy/client-core/transport';
import { configurePlatform } from '@moxxy/client-core/platform';
import type { MoxxyApi, SessionsOverview } from '@moxxy/desktop-ipc-contract';
import type { MoxxyEvent } from '@moxxy/sdk';

import type { OfficeDirector } from '../sim/director.js';
import { officeUiStore, type RosterEntry, type WorkerStatus } from './officeUiStore.js';

interface SubagentPayload {
  readonly label?: string;
  readonly childSessionId?: string;
  readonly delta?: string;
  readonly text?: string;
  readonly name?: string;
}

class LiveTap {
  private readonly thinking = new Set<string>();
  private readonly asking = new Set<string>();
  private roster: SessionsOverview = { sessions: [], activeSessionId: null };
  private primaryId: string | null = null;

  constructor(
    private readonly api: MoxxyApi,
    private readonly director: OfficeDirector,
  ) {}

  start(): void {
    this.api.subscribe('runner.event', ({ workspaceId, event }) => {
      this.onRunnerEvent(workspaceId, event as MoxxyEvent);
    });
    this.api.subscribe('runner.turn.complete', ({ workspaceId }) => {
      this.thinking.delete(workspaceId);
      this.clearAsk(workspaceId);
      this.director.input({ kind: 'turn-complete', workspaceId });
      this.publishRoster();
    });
    this.api.subscribe('ask.request', ({ workspaceId }) => {
      this.asking.add(workspaceId);
      this.director.input({ kind: 'ask-opened', workspaceId });
      this.publishRoster();
    });
    // Worker spawned/removed/mode-switched — re-list the roster.
    this.api.subscribe('connection.changed', () => {
      void this.refreshRoster();
    });
    void this.refreshRoster();
  }

  async refreshRoster(): Promise<void> {
    try {
      this.roster = await this.api.invoke('sessions.list', {});
    } catch {
      return; // transient — connection.changed or the next call will retry
    }
    this.primaryId ??= this.roster.sessions[0]?.id ?? null;
    this.director.input({
      kind: 'roster',
      sessions: this.roster.sessions.map((s) => ({ id: s.id, name: s.name })),
      activeId: this.roster.activeSessionId,
    });
    this.publishRoster();
  }

  private statusOf(id: string): WorkerStatus {
    if (this.asking.has(id)) return 'awaiting-approval';
    if (this.thinking.has(id)) return 'thinking';
    return 'idle';
  }

  private publishRoster(): void {
    const entries: RosterEntry[] = this.roster.sessions.map((s) => ({
      id: s.id,
      name: s.name,
      status: this.statusOf(s.id),
      isPrimary: s.id === this.primaryId,
    }));
    officeUiStore.setRoster(entries);
  }

  private clearAsk(workspaceId: string): void {
    if (!this.asking.delete(workspaceId)) return;
    this.director.input({ kind: 'ask-cleared', workspaceId });
    this.publishRoster();
  }

  private onRunnerEvent(workspaceId: string, event: MoxxyEvent): void {
    // Any post-ask progress means the ask was answered (here or in another tab).
    if (
      this.asking.has(workspaceId) &&
      (event.type === 'tool_call_approved' ||
        event.type === 'tool_call_denied' ||
        event.type === 'tool_result' ||
        event.type === 'assistant_chunk' ||
        event.type === 'assistant_message')
    ) {
      this.clearAsk(workspaceId);
    }

    switch (event.type) {
      case 'user_prompt':
        if (!this.thinking.has(workspaceId)) {
          this.thinking.add(workspaceId);
          this.director.input({ kind: 'turn-started', workspaceId });
          this.publishRoster();
        }
        return;
      case 'assistant_chunk':
        this.director.input({ kind: 'assistant-delta', workspaceId, delta: event.delta });
        return;
      case 'assistant_message': {
        const text =
          typeof event.content === 'string'
            ? event.content
            : ((event as unknown as { text?: string }).text ?? '');
        if (text) this.director.input({ kind: 'assistant-final', workspaceId, text });
        return;
      }
      case 'tool_call_requested':
        this.director.input({ kind: 'tool-call', workspaceId, tool: event.name });
        return;
      case 'tool_call_denied':
        this.director.input({ kind: 'tool-denied', workspaceId });
        return;
      case 'tool_result':
        if (!event.ok) this.director.input({ kind: 'tool-failed', workspaceId });
        return;
      case 'plugin_event':
        this.onPluginEvent(workspaceId, event.subtype, event.payload as SubagentPayload);
        return;
      default:
        return;
    }
  }

  private onPluginEvent(workspaceId: string, subtype: string, payload: SubagentPayload): void {
    const childId = payload?.childSessionId;
    if (!childId) return;
    switch (subtype) {
      case 'subagent_started':
        this.director.input({
          kind: 'subagent-started',
          workspaceId,
          childId,
          label: payload.label ?? 'subagent',
        });
        return;
      case 'subagent_chunk':
        if (payload.delta) {
          this.director.input({ kind: 'subagent-delta', childId, delta: payload.delta });
        }
        return;
      case 'subagent_tool_call':
        this.director.input({ kind: 'subagent-tool', childId, tool: payload.name ?? 'tool' });
        return;
      case 'subagent_completed':
        this.director.input({ kind: 'subagent-done', childId, text: payload.text ?? '' });
        return;
      case 'subagent_error':
      case 'subagent_abort':
        this.director.input({ kind: 'subagent-done', childId, failed: true });
        return;
      default:
        return;
    }
  }
}

/** Resolve the WS endpoint from the channel's /config and open the transport. */
export async function bootLive(director: OfficeDirector): Promise<MoxxyApi> {
  const token = new URLSearchParams(window.location.search).get('t') ?? '';
  const res = await fetch(`/config?t=${encodeURIComponent(token)}`);
  if (!res.ok) {
    officeUiStore.setConnection('disconnected');
    throw new Error(`office /config failed: ${res.status}`);
  }
  const { wsUrl } = (await res.json()) as { wsUrl: string };

  const api = makeWsApi({
    url: wsUrl,
    token,
    onStatus: (status) => {
      officeUiStore.setConnection(
        status === 'open'
          ? 'open'
          : status === 'reconnecting'
            ? 'reconnecting'
            : status === 'disconnected'
              ? 'disconnected'
              : 'connecting',
      );
    },
  });
  configureTransport(api);
  configurePlatform({});

  new LiveTap(api, director).start();
  return api;
}
