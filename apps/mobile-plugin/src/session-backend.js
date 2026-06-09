import { randomBytes } from 'node:crypto';
import { appendFileSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { createDesktopChatCatalog, createEmptyDesktopChatCatalog } from './desktop-chat-catalog.js';
import { createSessionCatalog } from './session-catalog.js';
import { createWorkspaceCatalog } from './workspace-catalog.js';

export function createMobilePromptHub() {
  const pendingPermissions = new Map();
  const pendingAsks = new Map();
  let broadcast = () => undefined;
  let autoApprove = false;
  let seq = 0;

  const hub = {
    permissionResolver: {
      name: 'mobile-gateway-permissions',
      async check(call, ctx) {
        if (autoApprove) return { mode: 'allow', reason: 'mobile bypass mode' };
        const id = String(call.callId ?? `perm_${++seq}`);
        const permission = {
          id,
          title: `Allow ${call.name}?`,
          tool: {
            name: call.name,
            input: call.input,
            ...(ctx.toolDescription ? { description: ctx.toolDescription } : {}),
          },
          call,
          ctx,
        };
        return await new Promise((resolve) => {
          pendingPermissions.set(id, { resolve, permission });
          broadcast({ type: 'permission.requested', permission });
        });
      },
    },
    approvalResolver: {
      name: 'mobile-gateway-approvals',
      async confirm(request) {
        const requestId = `ask_${++seq}_${randomBytes(4).toString('hex')}`;
        const ask = {
          requestId,
          kind: 'approval',
          title: request.title,
          body: request.body,
          approval: request,
        };
        return await new Promise((resolve) => {
          pendingAsks.set(requestId, { resolve, ask });
          broadcast({ type: 'ask.request', ask });
        });
      },
    },
    setBroadcast(next) {
      broadcast = next;
    },
    setAutoApprove(next) {
      autoApprove = next;
    },
    getAutoApprove() {
      return autoApprove;
    },
    pendingSnapshot() {
      return {
        pendingPermissions: [...pendingPermissions.values()].map((entry) => entry.permission),
        pendingAsks: [...pendingAsks.values()].map((entry) => entry.ask),
      };
    },
    resolvePermission(id, rawDecision) {
      const pending = pendingPermissions.get(id);
      if (!pending) return false;
      pendingPermissions.delete(id);
      const mode = normalizePermissionMode(rawDecision?.mode);
      pending.resolve({ mode });
      broadcast({ type: 'permission.resolved', permissionId: id });
      return true;
    },
    resolveAsk(requestId, response) {
      const pending = pendingAsks.get(requestId);
      if (!pending) return false;
      pendingAsks.delete(requestId);
      pending.resolve(response && typeof response === 'object' ? response : {});
      broadcast({ type: 'ask.resolved', requestId });
      return true;
    },
    abortAll(reason = 'mobile gateway stopped') {
      for (const [id, pending] of pendingPermissions) {
        pending.resolve({ mode: 'deny', reason });
        broadcast({ type: 'permission.resolved', permissionId: id });
      }
      pendingPermissions.clear();
      for (const [requestId, pending] of pendingAsks) {
        pending.resolve({ optionId: '', text: reason });
        broadcast({ type: 'ask.resolved', requestId });
      }
      pendingAsks.clear();
    },
  };

  return hub;
}

export function createSessionMobileBackend(session, options = {}) {
  const promptHub = options.promptHub ?? createMobilePromptHub();
  const sessionCatalog = options.sessionCatalog ?? createSessionCatalog(options.sessionDir ? { dir: options.sessionDir } : {});
  const workspaceCatalog = options.workspaceCatalog ?? createWorkspaceCatalog();
  const desktopChatCatalog = options.desktopChatCatalog ?? (
    options.desktopChatDir || !options.sessionDir
      ? createDesktopChatCatalog({
          ...(options.desktopChatDir ? { dir: options.desktopChatDir } : {}),
          workspaceCatalog,
        })
      : createEmptyDesktopChatCatalog()
  );
  let broadcast = options.broadcast ?? (() => undefined);
  const turnControllers = new Map();
  const eventTurnSessionIds = new Map();
  const runtimeEventsBySessionId = new Map();
  const streamingTextBySessionId = new Map();
  const usageBySessionId = new Map();
  const unreadSessionIds = new Set();
  let activeTurnId = null;
  let hydratedSessionId = null;
  let hydrating = false;
  let pendingRuntimeSessionId = null;
  let selectedSessionId = null;
  let sending = false;
  let workflows = [];
  let unsubscribe = null;

  promptHub.setBroadcast((frame) => broadcast(frame));

  return {
    promptHub,
    setBroadcast(next) {
      broadcast = next;
      promptHub.setBroadcast(next);
    },
    start() {
      unsubscribe = session.log?.subscribe?.((event) => {
        if (hydrating) return;
        const ownerSessionId = resolveIncomingEventSessionId(event);
        const mobileEvent = eventForMobileSession(event, ownerSessionId);
        applyLiveStreamingEvent(ownerSessionId, mobileEvent);
        const previousUsage = usageBySessionId.get(ownerSessionId) ?? null;
        cacheRuntimeEvents(ownerSessionId);
        const usageChanged = usageSnapshotsDiffer(previousUsage, usageBySessionId.get(ownerSessionId) ?? null);
        persistRuntimeEvent(mobileEvent, ownerSessionId);
        if (getSelectedSessionId() === ownerSessionId && selectedSessionUsesRuntime()) {
          broadcast({ type: 'event', event: mobileEvent });
          if (usageChanged) broadcast({ type: 'snapshot', snapshot: this.snapshot() });
          return;
        }
        unreadSessionIds.add(ownerSessionId);
        broadcast({ type: 'snapshot', snapshot: this.snapshot() });
      }) ?? null;
      void refreshWorkflowsAndBroadcast().catch((err) => {
        broadcast({ type: 'error', message: err instanceof Error ? err.message : String(err) });
      });
      return () => {
        unsubscribe?.();
        unsubscribe = null;
      };
    },
    stop() {
      for (const controller of turnControllers.values()) controller.abort('mobile gateway stopped');
      turnControllers.clear();
      promptHub.abortAll();
      unsubscribe?.();
      unsubscribe = null;
    },
    health() {
      return { status: 'ok', bridge: { ok: true, type: 'session' } };
    },
    snapshot() {
      return buildSessionSnapshot(session, {
        activeTurnId,
        autoApprove: promptHub.getAutoApprove(),
        sending,
        selectedSessionId: getSelectedSessionId(),
        hydratedSessionId,
        runtimeSessionId: getRuntimeSessionId(),
        runtimeEventsBySessionId,
        usageBySessionId,
        sessionCatalog,
        workspaceCatalog,
        desktopChatCatalog,
        unreadSessionIds,
        workflows,
        ...promptHub.pendingSnapshot(),
      });
    },
    async handleClientFrame(frame, owner) {
      switch (frame.type) {
        case 'ask.respond':
          promptHub.resolveAsk(String(frame.requestId), frame.response);
          return { handled: true, frame: { type: 'ask.resolved', id: frame.id, requestId: frame.requestId } };
        case 'permission.decision':
          promptHub.resolvePermission(String(frame.permissionId), frame.decision);
          return { handled: true, frame: { type: 'permission.resolved', id: frame.id, permissionId: frame.permissionId } };
        case 'runTurn':
        case 'run':
          if (!canRunOnSelectedSession()) {
            sendDirect(owner, {
              type: 'error',
              message: 'Selected session is an archive. Select the live session to send messages.',
            });
            return { handled: true };
          }
          startTurn(frame, owner);
          return { handled: true, frame: { type: 'connection', status: 'run.accepted', id: frame.id } };
        case 'abortTurn':
        case 'abort':
          abortTurn(frame);
          return { handled: true, frame: { type: 'connection', status: 'abort.accepted', id: frame.id } };
        case 'setAutoApprove':
          promptHub.setAutoApprove(frame.enabled === true);
          broadcast({ type: 'snapshot', snapshot: this.snapshot() });
          return {
            handled: true,
            frame: { type: 'connection', status: 'auto-approve.updated', id: frame.id, autoApprove: frame.enabled === true },
          };
        case 'setMode':
          if (typeof frame.mode === 'string') session.modes?.setActive?.(frame.mode);
          broadcast({ type: 'snapshot', snapshot: this.snapshot() });
          return { handled: true, frame: { type: 'connection', status: 'mode.updated', id: frame.id } };
        case 'runCommand':
        case 'command':
          await runCommand(frame);
          return { handled: true };
        case 'workflow.list':
          await refreshWorkflowsAndBroadcast();
          return { handled: true, frame: { type: 'connection', status: 'workflow.listed', id: frame.id } };
        case 'workflow.run':
          return { handled: true, frame: await runWorkflow(frame, owner) };
        case 'newSession':
          selectedSessionId = getLiveSessionId();
          hydratedSessionId = null;
          pendingRuntimeSessionId = null;
          streamingTextBySessionId.clear();
          unreadSessionIds.delete(selectedSessionId);
          usageBySessionId.delete(selectedSessionId);
          session.log?.clear?.();
          broadcast({ type: 'snapshot', snapshot: this.snapshot() });
          return { handled: true, frame: { type: 'connection', status: 'session.new', id: frame.id } };
        case 'selectWorkspace':
        case 'selectSession':
          await selectSession(frame);
          broadcast({ type: 'snapshot', snapshot: this.snapshot() });
          return {
            handled: true,
            frame: {
              type: 'connection',
              status: 'workspace.selected',
              id: frame.id,
              activeWorkspaceId: getSelectedSessionId(),
            },
          };
        case 'transcribe':
          return { handled: true, frame: await transcribe(frame) };
        default:
          return { handled: false };
      }
    },
  };

  function getLiveSessionId() {
    const info = session.getInfo?.() ?? {};
    return String(info.sessionId ?? session.id ?? 'session');
  }

  function getSelectedSessionId() {
    return selectedSessionId ?? getLiveSessionId();
  }

  function getRuntimeSessionId() {
    return hydratedSessionId ?? getLiveSessionId();
  }

  function canRunOnSelectedSession() {
    return selectedSessionUsesRuntime();
  }

  function selectedSessionUsesRuntime() {
    return getSelectedSessionId() === getRuntimeSessionId();
  }

  async function selectSession(frame) {
    const requested = typeof frame.sessionId === 'string'
      ? frame.sessionId
      : typeof frame.workspaceId === 'string'
        ? frame.workspaceId
        : getLiveSessionId();
    if (requested !== getLiveSessionId() && !sessionCatalog.hasSession(requested) && !desktopChatCatalog.hasSession(requested)) return;
    selectedSessionId = requested;
    unreadSessionIds.delete(requested);
    if (requested === getRuntimeSessionId()) {
      pendingRuntimeSessionId = null;
      return;
    }
    if (runtimeBusy()) {
      pendingRuntimeSessionId = requested;
      return;
    }
    await activateRuntimeSession(requested);
  }

  function runtimeBusy() {
    return turnControllers.size > 0 || sending === true;
  }

  async function activateRuntimeSession(sessionId) {
    pendingRuntimeSessionId = null;
    cacheRuntimeEvents(getRuntimeSessionId());
    if (sessionId === getLiveSessionId()) {
      if (runtimeEventsBySessionId.has(sessionId)) {
        await restoreRuntimeEvents(runtimeEventsBySessionId.get(sessionId), sessionId);
      } else if (hydratedSessionId !== null && (sessionCatalog.hasSession(sessionId) || desktopChatCatalog.hasSession(sessionId))) {
        await hydrateRuntimeSession(sessionId);
      }
      hydratedSessionId = null;
      streamingTextBySessionId.delete(sessionId);
      unreadSessionIds.delete(sessionId);
      return true;
    }
    if (!(await hydrateRuntimeSession(sessionId))) return false;
    hydratedSessionId = sessionId;
    streamingTextBySessionId.delete(sessionId);
    unreadSessionIds.delete(sessionId);
    unreadSessionIds.delete(getLiveSessionId());
    return true;
  }

  function cacheRuntimeEvents(sessionId) {
    if (typeof sessionId !== 'string' || sessionId.length === 0) return;
    const normalized = normalizeRuntimeEventsForSession(session.log?.slice?.(0) ?? [], sessionId);
    runtimeEventsBySessionId.set(sessionId, normalized);
    usageBySessionId.set(sessionId, usageFromEvents(normalized));
  }

  async function restoreRuntimeEvents(events, sessionId) {
    const normalized = normalizeHydratedEvents(Array.isArray(events) ? events : [], sessionId);
    if (typeof session.restoreLog === 'function') {
      hydrating = true;
      try {
        await session.restoreLog(normalized);
      } finally {
        hydrating = false;
      }
      return true;
    }
    const log = session.log;
    if (typeof log?.clear !== 'function' || typeof log?.ingest !== 'function') return false;
    hydrating = true;
    try {
      log.clear();
      for (const event of normalized) {
        log.ingest(event);
      }
    } finally {
      hydrating = false;
    }
    return true;
  }

  async function hydrateRuntimeSession(sessionId) {
    const source = desktopChatCatalog.hasSession(sessionId) ? desktopChatCatalog : sessionCatalog;
    const events = normalizeHydratedEvents(source.readSessionEvents(sessionId), sessionId);
    runtimeEventsBySessionId.set(sessionId, events);
    usageBySessionId.set(sessionId, usageFromEvents(events));
    return await restoreRuntimeEvents(events, sessionId);
  }

  function persistRuntimeEvent(event, ownerSessionId) {
    if (ownerSessionId === getLiveSessionId()) return;
    try {
      const persistedEvent = {
        ...event,
        sessionId: ownerSessionId,
      };
      if (desktopChatCatalog.hasSession(ownerSessionId)) {
        desktopChatCatalog.appendSessionEvent(ownerSessionId, persistedEvent);
        return;
      }
      const dir = sessionCatalog.dir;
      if (typeof dir !== 'string' || dir.length === 0) return;
      appendFileSync(join(dir, `${ownerSessionId}.jsonl`), `${JSON.stringify(persistedEvent)}\n`, 'utf8');
      updateHydratedMeta(dir, ownerSessionId, persistedEvent);
    } catch {
      // Persistence mirrors must not break the live mobile conversation.
    }
  }

  function startTurn(frame, owner) {
    if (typeof frame.prompt !== 'string' || frame.prompt.trim().length === 0) {
      broadcast({ type: 'error', message: 'runTurn requires a non-empty prompt' });
      return;
    }
    const key = typeof frame.id === 'string' ? frame.id : `turn_${Date.now()}`;
    const controller = new AbortController();
    turnControllers.set(key, controller);
    activeTurnId = key;
    sending = true;
    streamingTextBySessionId.set(getRuntimeSessionId(), '');
    broadcast({ type: 'snapshot', snapshot: thisSnapshot() });

    void (async () => {
      try {
        const opts = {
          signal: controller.signal,
          ...(typeof frame.model === 'string' ? { model: frame.model } : {}),
          ...(typeof frame.systemPrompt === 'string' ? { systemPrompt: frame.systemPrompt } : {}),
        };
        for await (const _event of session.runTurn(frame.prompt.trim(), opts)) {
          void _event;
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const ownerSessionId = getRuntimeSessionId();
        streamingTextBySessionId.delete(ownerSessionId);
        sendDirect(owner, { type: 'error', message });
        broadcast({ type: 'event', event: eventForMobileSession({ type: 'turn_error', message }, ownerSessionId) });
      } finally {
        turnControllers.delete(key);
        if (activeTurnId === key) activeTurnId = null;
        sending = turnControllers.size > 0;
        if (!runtimeBusy() && pendingRuntimeSessionId && pendingRuntimeSessionId === getSelectedSessionId()) {
          await activateRuntimeSession(pendingRuntimeSessionId);
        }
        broadcast({ type: 'snapshot', snapshot: thisSnapshot() });
      }
    })();
  }

  function thisSnapshot() {
    return buildSessionSnapshot(session, {
      activeTurnId,
      autoApprove: promptHub.getAutoApprove(),
      sending,
      selectedSessionId: getSelectedSessionId(),
      hydratedSessionId,
      runtimeSessionId: getRuntimeSessionId(),
      runtimeEventsBySessionId,
      streamingTextBySessionId,
      sessionCatalog,
      workspaceCatalog,
      desktopChatCatalog,
      unreadSessionIds,
      workflows,
      ...promptHub.pendingSnapshot(),
    });
  }

  function resolveIncomingEventSessionId(event) {
    const turnId = typeof event?.turnId === 'string' ? event.turnId : null;
    if (turnId && eventTurnSessionIds.has(turnId)) return eventTurnSessionIds.get(turnId);
    if (turnControllers.size === 1) {
      const owner = getRuntimeSessionId();
      if (turnId) eventTurnSessionIds.set(turnId, owner);
      return owner;
    }
    return getRuntimeSessionId();
  }

  function applyLiveStreamingEvent(sessionId, event) {
    const type = typeof event?.type === 'string' ? event.type : '';
    if (type === 'assistant_chunk') {
      const delta = firstString(event.delta, event.text, event.content);
      if (delta.length > 0) {
        streamingTextBySessionId.set(sessionId, `${streamingTextBySessionId.get(sessionId) ?? ''}${delta}`);
      }
      return;
    }
    if (clearsLiveStreaming(type)) {
      streamingTextBySessionId.delete(sessionId);
    }
  }

  function abortTurn(frame) {
    const keys = [frame.turnId, frame.id].filter((value) => typeof value === 'string');
    if (keys.length === 0) {
      for (const controller of turnControllers.values()) controller.abort('mobile requested abort');
      return;
    }
    for (const key of keys) turnControllers.get(key)?.abort('mobile requested abort');
  }

  async function runCommand(frame) {
    if (typeof frame.name !== 'string') return;
    const command = session.commands?.get?.(frame.name);
    if (!command) return;
    broadcast({ type: 'connection', status: 'command.started', id: frame.id, commandName: frame.name });
    try {
      const result = await command.handler({
        channel: 'mobile',
        sessionId: session.id,
        args: typeof frame.args === 'string' ? frame.args : '',
        session,
      });
      broadcast({ type: 'event', event: { type: 'command', name: frame.name, result } });
      broadcast({ type: 'connection', status: 'command.completed', id: frame.id, commandName: frame.name });
    } catch (err) {
      broadcast({
        type: 'connection',
        status: 'command.failed',
        id: frame.id,
        commandName: frame.name,
      });
      throw err;
    }
  }

  async function refreshWorkflowsAndBroadcast() {
    await refreshWorkflows();
    broadcast({ type: 'snapshot', snapshot: thisSnapshot() });
  }

  async function refreshWorkflows() {
    const list = await session.workflows?.list?.();
    workflows = Array.isArray(list) ? list.map(normalizeWorkflowSummary) : [];
    return workflows;
  }

  async function runWorkflow(frame, owner) {
    if (typeof frame.name !== 'string' || frame.name.trim().length === 0) {
      return { type: 'error', id: frame.id, message: 'workflow.run requires a workflow name' };
    }
    if (typeof session.workflows?.run !== 'function') {
      return { type: 'error', id: frame.id, message: 'No workflow runtime is registered for this session.' };
    }
    const name = frame.name.trim();
    try {
      const result = await session.workflows.run(name);
      broadcast({ type: 'event', event: { type: 'workflow_run', name, result } });
      await refreshWorkflowsAndBroadcast();
      return { type: 'connection', status: 'workflow.run.completed', id: frame.id, name };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      sendDirect(owner, { type: 'event', event: { type: 'workflow_run', name, result: { ok: false, error: message } } });
      return { type: 'error', id: frame.id, message };
    }
  }

  async function transcribe(frame) {
    if (!canRunOnSelectedSession()) {
      return {
        type: 'error',
        message: 'Selected session is an archive. Select the live session to use voice input.',
      };
    }
    if (typeof frame.audioBase64 !== 'string' || frame.audioBase64.length === 0) {
      return { type: 'error', message: 'transcribe requires audioBase64' };
    }
    const transcriber = resolveTranscriber();
    const audio = new Uint8Array(Buffer.from(frame.audioBase64, 'base64'));
    const result = await transcriber.transcribe(audio, {
      ...(typeof frame.mimeType === 'string' ? { mimeType: frame.mimeType } : {}),
      ...(typeof frame.language === 'string' ? { language: frame.language } : {}),
      ...(typeof frame.prompt === 'string' ? { prompt: frame.prompt } : {}),
    });
    return {
      type: 'transcribe.result',
      id: frame.id,
      text: typeof result?.text === 'string' ? result.text : '',
    };
  }

  function resolveTranscriber() {
    const registry = session.transcribers;
    if (!registry) {
      throw new Error('No speech-to-text backend is registered for this session.');
    }
    const candidates = transcribeCandidates(registry);
    if (candidates.length === 0) {
      throw new Error('No speech-to-text backend is registered for this session.');
    }
    let lastError = null;
    for (const name of candidates) {
      try {
        return registry.setActive(name);
      } catch (err) {
        lastError = err;
      }
    }
    throw lastError ?? new Error('No speech-to-text backend is available for this session.');
  }

  function transcribeCandidates(registry) {
    const activeName = registry.getActiveName?.();
    const names = registry.list?.().map((item) => item.name).filter((name) => typeof name === 'string') ?? [];
    return [...new Set([activeName, ...names].filter((name) => typeof name === 'string' && name.length > 0))];
  }
}

function buildSessionSnapshot(session, state) {
  const info = session.getInfo?.() ?? {};
  const sessionId = info.sessionId ?? session.id ?? 'session';
  const cwd = info.cwd ?? session.cwd ?? '';
  const selectedSessionId = state.selectedSessionId ?? sessionId;
  const runtimeSessionId = state.runtimeSessionId ?? state.hydratedSessionId ?? sessionId;
  const selectedUsesRuntime = selectedSessionId === runtimeSessionId;
  const sessions = buildMobileSessions(session, state, info, sessionId, cwd);
  const selectedSession = sessions.find((item) => item.id === selectedSessionId) ?? liveSessionRecord(session, info, sessionId, cwd, state);
  const runtimeEvents = selectedUsesRuntime
    ? normalizeRuntimeEventsForSession(session.log?.slice?.(0) ?? [], selectedSessionId)
    : readStoredSessionEvents(state, selectedSessionId);
  const chatEvents = snapshotChatEvents(runtimeEvents);
  const usage = buildUsageSnapshot(
    state.usageBySessionId?.get(selectedSessionId) ?? usageFromEvents(runtimeEvents),
    info,
    selectedSession,
  );
  return {
    activeWorkspaceId: selectedSessionId,
    workspaces: realWorkspaceRecords(state.workspaceCatalog),
    sessions,
    session: {
      id: selectedSession.id,
      cwd: selectedSession.cwd,
      live: selectedSession.live,
      readOnly: selectedSession.readOnly,
      firstPrompt: selectedSession.firstPrompt,
      lastActivity: selectedSession.lastActivity,
      eventCount: selectedSession.eventCount,
      provider: selectedSession.provider,
      model: selectedSession.model,
    },
    agents: session.agents?.list?.().map((agent) => ({ id: agent.name ?? agent.id, label: agent.description ?? agent.name ?? agent.id })) ?? [],
    workflows: state.workflows ?? [],
    pendingPermissions: state.pendingPermissions ?? [],
    pendingAsks: state.pendingAsks ?? [],
    commands: info.commands ?? [],
    chatEvents,
    streamingText: selectedUsesRuntime
      ? state.streamingTextBySessionId?.get?.(selectedSessionId) ?? streamingTextFromEvents(runtimeEvents)
      : '',
    sending: selectedUsesRuntime && state.sending === true,
    activeTurnId: selectedUsesRuntime ? state.activeTurnId ?? null : null,
    queue: [],
    compacting: false,
    usage,
    autoApprove: state.autoApprove === true,
    activeMode: selectedUsesRuntime ? info.activeMode ?? null : 'archive',
    activeProvider: selectedSession.provider ?? info.activeProvider ?? null,
    modeBadge: selectedUsesRuntime ? info.activeModeBadge ?? null : { label: 'Archive' },
  };
}

function eventForMobileSession(event, sessionId) {
  if (typeof sessionId !== 'string' || sessionId.length === 0) return event;
  return {
    ...event,
    sessionId,
  };
}

function normalizeRuntimeEventsForSession(events, sessionId) {
  return normalizeHydratedEvents(events, sessionId).map((event) => eventForMobileSession(event, sessionId));
}

function snapshotChatEvents(events) {
  return (Array.isArray(events) ? events : []).filter((event) => event?.type !== 'assistant_chunk');
}

function streamingTextFromEvents(events) {
  let text = '';
  for (const event of Array.isArray(events) ? events : []) {
    if (event?.type === 'assistant_chunk') {
      text += firstString(event.delta, event.text, event.content);
      continue;
    }
    if (clearsLiveStreaming(event?.type)) text = '';
  }
  return text;
}

function clearsLiveStreaming(type) {
  return type === 'assistant_message' || type === 'user_prompt' || type === 'user' || type === 'abort' || type === 'error' || type === 'turn_error';
}

function firstString(...values) {
  for (const value of values) {
    if (typeof value === 'string' && value.length > 0) return value;
  }
  return '';
}

function buildUsageSnapshot(usage, info, selectedSession) {
  const contextWindow = resolveContextWindow(
    info,
    usage?.model ?? selectedSession?.model ?? null,
    usage?.provider ?? selectedSession?.provider ?? info?.activeProvider ?? null,
  );
  if (!usage && contextWindow == null) return null;
  const base = usage ?? emptyUsageSnapshot();
  return {
    ...base,
    contextWindow,
  };
}

function resolveContextWindow(info, model, providerName) {
  const providers = Array.isArray(info?.providers) ? info.providers : [];
  const provider = providers.find((candidate) => candidate?.name === providerName) ?? providers[0];
  if (!provider || !Array.isArray(provider.models)) return null;
  const match = typeof model === 'string' ? provider.models.find((candidate) => candidate?.id === model) : null;
  const window = match?.contextWindow ?? provider.models[0]?.contextWindow ?? null;
  return typeof window === 'number' && Number.isFinite(window) && window > 0 ? window : null;
}

function emptyUsageSnapshot() {
  return {
    latestPrompt: null,
    perCall: [],
    calls: 0,
    totalInput: 0,
    totalCacheRead: 0,
    totalCacheCreation: 0,
    totalOutput: 0,
    provider: null,
    model: null,
  };
}

function usageFromEvents(events) {
  const usage = emptyUsageSnapshot();
  for (const event of Array.isArray(events) ? events : []) {
    applyUsageEvent(usage, event);
  }
  return usage.calls > 0 || usage.latestPrompt != null ? usage : null;
}

function applyUsageEvent(usage, event) {
  if (event?.type === 'compaction') {
    const saved = typeof event.tokensSaved === 'number' ? event.tokensSaved : 0;
    if (saved <= 0 || usage.latestPrompt == null) return false;
    usage.latestPrompt = Math.max(0, usage.latestPrompt - saved);
    return true;
  }
  if (event?.type !== 'provider_response') return false;
  const hasUsage =
    event.inputTokens !== undefined ||
    event.outputTokens !== undefined ||
    event.cacheReadTokens !== undefined ||
    event.cacheCreationTokens !== undefined;
  if (!hasUsage) return false;
  const hasPrompt =
    event.inputTokens !== undefined ||
    event.cacheReadTokens !== undefined ||
    event.cacheCreationTokens !== undefined;
  const input = event.inputTokens ?? 0;
  const cacheRead = event.cacheReadTokens ?? 0;
  const cacheCreation = event.cacheCreationTokens ?? 0;
  const output = event.outputTokens ?? 0;
  const prompt = input + cacheRead + cacheCreation;
  if (hasPrompt) {
    usage.latestPrompt = prompt;
    usage.perCall = [...usage.perCall, prompt];
  }
  usage.calls += 1;
  usage.totalInput += input;
  usage.totalCacheRead += cacheRead;
  usage.totalCacheCreation += cacheCreation;
  usage.totalOutput += output;
  usage.provider = typeof event.provider === 'string' ? event.provider : usage.provider;
  usage.model = typeof event.model === 'string' ? event.model : usage.model;
  return true;
}

function usageSnapshotsDiffer(a, b) {
  return (
    (a?.latestPrompt ?? null) !== (b?.latestPrompt ?? null) ||
    (a?.calls ?? 0) !== (b?.calls ?? 0) ||
    (a?.totalInput ?? 0) !== (b?.totalInput ?? 0) ||
    (a?.totalCacheRead ?? 0) !== (b?.totalCacheRead ?? 0) ||
    (a?.totalCacheCreation ?? 0) !== (b?.totalCacheCreation ?? 0) ||
    (a?.totalOutput ?? 0) !== (b?.totalOutput ?? 0)
  );
}

function buildMobileSessions(session, state, info, liveSessionId, cwd) {
  const byId = new Map();
  for (const meta of state.desktopChatCatalog?.listSessions?.() ?? []) {
    if (!hasSessionContext(meta)) continue;
    byId.set(meta.id, archiveSessionRecord(meta, state));
  }
  for (const meta of state.sessionCatalog?.listSessions?.() ?? []) {
    if (!hasSessionContext(meta)) continue;
    byId.set(meta.id, archiveSessionRecord(meta, state));
  }
  byId.set(liveSessionId, liveSessionRecord(session, info, liveSessionId, cwd, state));
  return [...byId.values()].sort((a, b) => {
    const byActivity = String(b.lastActivity ?? '').localeCompare(String(a.lastActivity ?? ''));
    if (byActivity !== 0) return byActivity;
    if (a.live && !b.live) return -1;
    if (!a.live && b.live) return 1;
    return String(a.id).localeCompare(String(b.id));
  });
}

function hasSessionContext(meta) {
  return meta.eventCount > 0 && typeof meta.firstPrompt === 'string' && meta.firstPrompt.trim().length > 0;
}

function liveSessionRecord(session, info, sessionId, cwd, state) {
  const events = session.log?.slice?.(0) ?? [];
  const firstPrompt = firstPromptFromEvents(events);
  const now = new Date().toISOString();
  const workspace = state.workspaceCatalog?.resolve?.(cwd) ?? othersWorkspace();
  const usesRuntime = (state.runtimeSessionId ?? sessionId) === sessionId;
  return {
    id: sessionId,
    name: firstPrompt ?? (basename(cwd) || 'Moxxy'),
    cwd,
    workspaceId: workspace.id,
    workspaceName: workspace.name,
    workspaceColor: workspace.color,
    startedAt: now,
    lastActivity: latestEventTime(events) ?? now,
    eventCount: events.length,
    firstPrompt,
    provider: info.activeProvider ?? null,
    model: null,
    live: usesRuntime,
    readOnly: !usesRuntime,
    unread: state.unreadSessionIds?.has?.(sessionId) === true,
  };
}

function archiveSessionRecord(meta, state) {
  const hydrated = meta.id === state.runtimeSessionId;
  const workspace = state.workspaceCatalog?.resolve?.(meta.cwd) ?? othersWorkspace();
  return {
    id: meta.id,
    name: meta.firstPrompt ?? (basename(meta.cwd) || meta.id),
    cwd: meta.cwd,
    workspaceId: workspace.id,
    workspaceName: workspace.name,
    workspaceColor: workspace.color,
    startedAt: meta.startedAt,
    lastActivity: meta.lastActivity,
    eventCount: meta.eventCount,
    firstPrompt: meta.firstPrompt,
    provider: meta.provider,
    model: meta.model,
    live: hydrated,
    readOnly: !hydrated,
    unread: state.unreadSessionIds?.has?.(meta.id) === true,
  };
}

function realWorkspaceRecords(workspaceCatalog) {
  return (workspaceCatalog?.list?.() ?? []).map((workspace) => ({
    id: workspace.id,
    name: workspace.name,
    cwd: workspace.cwd,
    color: workspace.color,
  }));
}

function readStoredSessionEvents(state, sessionId) {
  if (state.runtimeEventsBySessionId?.has?.(sessionId)) {
    return state.runtimeEventsBySessionId.get(sessionId);
  }
  if (state.desktopChatCatalog?.hasSession?.(sessionId)) {
    return state.desktopChatCatalog.readSessionEvents(sessionId);
  }
  return state.sessionCatalog?.readSessionEvents?.(sessionId) ?? [];
}

function othersWorkspace() {
  return {
    id: 'others',
    name: 'Others',
    color: '#ec4899',
  };
}

function normalizeHydratedEvents(events, sessionId) {
  const baseTs = Date.now();
  return events
    .filter((event) => event && typeof event === 'object' && typeof event.type === 'string')
    .map((event, index) => ({
      ...event,
      id: typeof event.id === 'string' ? event.id : `${sessionId}-${index}`,
      seq: index,
      ts: normalizeEventTimestamp(event.ts, baseTs + index),
      sessionId: typeof event.sessionId === 'string' ? event.sessionId : sessionId,
      turnId: typeof event.turnId === 'string' ? event.turnId : `resume-${sessionId}`,
      source: typeof event.source === 'string' ? event.source : inferHydratedEventSource(event),
    }));
}

function updateHydratedMeta(dir, sessionId, event) {
  const now = new Date().toISOString();
  const metaPath = join(dir, `${sessionId}.meta.json`);
  const current = readHydratedMeta(metaPath, sessionId, now);
  const next = {
    ...current,
    eventCount: Number.isFinite(current.eventCount) ? current.eventCount + 1 : 1,
    lastActivity: now,
    firstPrompt: current.firstPrompt ?? (event.type === 'user_prompt' && typeof event.text === 'string' ? event.text.slice(0, 80) : null),
  };
  writeJsonAtomic(metaPath, next);
}

function readHydratedMeta(metaPath, sessionId, now) {
  try {
    const parsed = JSON.parse(readFileSync(metaPath, 'utf8'));
    if (parsed && typeof parsed === 'object') {
      return {
        id: typeof parsed.id === 'string' ? parsed.id : sessionId,
        cwd: typeof parsed.cwd === 'string' ? parsed.cwd : '',
        startedAt: typeof parsed.startedAt === 'string' ? parsed.startedAt : now,
        lastActivity: typeof parsed.lastActivity === 'string' ? parsed.lastActivity : now,
        eventCount: typeof parsed.eventCount === 'number' ? parsed.eventCount : 0,
        firstPrompt: typeof parsed.firstPrompt === 'string' ? parsed.firstPrompt : null,
        provider: typeof parsed.provider === 'string' ? parsed.provider : null,
        model: typeof parsed.model === 'string' ? parsed.model : null,
      };
    }
  } catch {
    // Fall through to a minimal sidecar.
  }
  return {
    id: sessionId,
    cwd: '',
    startedAt: now,
    lastActivity: now,
    eventCount: 0,
    firstPrompt: null,
    provider: null,
    model: null,
  };
}

function writeJsonAtomic(filePath, value) {
  const tmpPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(tmpPath, JSON.stringify(value), 'utf8');
  renameSync(tmpPath, filePath);
}

function normalizeEventTimestamp(value, fallback) {
  if (typeof value === 'number') return value;
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

function inferHydratedEventSource(event) {
  if (event.type === 'user_prompt') return 'user';
  if (event.type === 'assistant_message' || event.type === 'assistant_chunk' || event.type === 'provider_response') return 'model';
  if (String(event.type).startsWith('tool_')) return 'tool';
  return 'system';
}

function firstPromptFromEvents(events) {
  const prompt = events.find((event) => event?.type === 'user_prompt' && typeof event.text === 'string');
  return prompt?.text?.slice?.(0, 80) ?? null;
}

function latestEventTime(events) {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const ts = events[index]?.ts;
    if (typeof ts === 'number') return new Date(ts).toISOString();
    if (typeof ts === 'string') return ts;
  }
  return null;
}

function normalizeWorkflowSummary(value, index) {
  const workflow = value && typeof value === 'object' ? value : {};
  return {
    name: stringValue(workflow.name, `workflow-${index + 1}`),
    description: stringValue(workflow.description, ''),
    enabled: workflow.enabled === true,
    scope: stringValue(workflow.scope, ''),
    steps: typeof workflow.steps === 'number' ? workflow.steps : 0,
    triggers: stringValue(workflow.triggers, ''),
  };
}

function stringValue(value, fallback) {
  return typeof value === 'string' && value.length > 0 ? value : fallback;
}

function normalizePermissionMode(mode) {
  if (mode === 'allow_once') return 'allow';
  if (mode === 'allow_session' || mode === 'allow_always' || mode === 'deny') return mode;
  return 'deny';
}

function sendDirect(ws, frame) {
  if (ws?.readyState === ws?.OPEN) ws.send(JSON.stringify(frame));
}
