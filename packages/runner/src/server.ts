import { AsyncLocalStorage } from 'node:async_hooks';
import type { Session } from '@moxxy/core';
import { loadPreferences, newTurnId, savePreferences } from '@moxxy/core';
import { asTurnId, createMutex } from '@moxxy/sdk';
import type {
  ApprovalDecision,
  ApprovalRequest,
  ApprovalResolver,
  MoxxyEvent,
  PendingToolCall,
  PermissionContext,
  PermissionDecision,
  PermissionResolver,
  TurnId,
  UserPromptAttachment,
} from '@moxxy/sdk';
import { JsonRpcPeer } from './jsonrpc.js';
import type { Transport, TransportServer } from './transport.js';
import { createUnixSocketServer } from './unix-socket.js';
import { runnerSocketPath } from './socket-path.js';
import {
  MIN_COMPATIBLE_PROTOCOL_VERSION,
  RUNNER_PROTOCOL_VERSION,
  RunnerMethod,
  RunnerNotification,
  abortParamsSchema,
  attachParamsSchema,
  commandRunParamsSchema,
  mcpDetachParamsSchema,
  mcpEnableAndAttachParamsSchema,
  modeSetActiveParamsSchema,
  permissionAddAllowParamsSchema,
  providerConfigureParamsSchema,
  providerSetActiveParamsSchema,
  providerSetEnabledParamsSchema,
  runTurnParamsSchema,
  setResolverParamsSchema,
  surfaceOpenParamsSchema,
  surfaceInputParamsSchema,
  surfaceResizeParamsSchema,
  surfaceCloseParamsSchema,
  transcribeParamsSchema,
  synthesizeParamsSchema,
  workflowRunParamsSchema,
  workflowSetEnabledParamsSchema,
  workflowValidateDraftParamsSchema,
  workflowSaveParamsSchema,
  workflowGetRunParamsSchema,
  workflowResumeParamsSchema,
  type AttachResult,
  type CommandRunResult,
  type RunTurnResult,
  type TranscribeResult,
  type SynthesizeResult,
} from './protocol.js';

/** One attached client and what it has opted into answering. */
interface ConnectedClient {
  readonly peer: JsonRpcPeer;
  role: string;
  attached: boolean;
  handlesPermission: boolean;
  handlesApproval: boolean;
  /** Turns this client started - aborted if it disconnects. */
  readonly turns: Set<TurnId>;
}

/** Carried through the turn's async context so resolvers can find the owner. */
interface TurnScope {
  readonly client: ConnectedClient;
  readonly turnId: TurnId;
}

/** An in-flight turn: its abort controller plus the connection that started it. */
interface TurnEntry {
  readonly controller: AbortController;
  readonly owner: ConnectedClient;
}

/**
 * Exposes a {@link Session} over a transport so thin clients can attach.
 *
 * The server owns the Session and the agentic loop. Clients drive turns via
 * `runTurn`, observe everything through a broadcast event stream, and answer
 * `permission.check` / `approval.confirm` for the turns they started. Per-turn
 * routing rides on an `AsyncLocalStorage` scope established around each turn -
 * so a permission prompt raised deep inside a strategy is delivered back to
 * exactly the client that asked for the turn. Turns run *outside* any scope
 * (e.g. a self-hosting TUI calling `session.runTurn` directly) fall through to
 * the resolvers that were installed before the server wrapped the session.
 */
export class RunnerServer {
  private readonly clients = new Set<ConnectedClient>();
  private readonly turnControllers = new Map<TurnId, TurnEntry>();
  private readonly scope = new AsyncLocalStorage<TurnScope>();
  private readonly logUnsub: () => void;
  private readonly logClearUnsub: () => void;
  private readonly modesUnsub: () => void;
  private readonly surfacesUnsub: () => void;
  /**
   * Resolvers for unscoped (local) turns - the fall-through path. Seeded from
   * whatever was installed before we wrapped the session, then kept current by
   * intercepting later `setPermissionResolver` / `setApprovalResolver` calls
   * (e.g. a self-hosting TUI mounting) so those don't clobber routing.
   */
  private fallbackPermission: PermissionResolver;
  private fallbackApproval: ApprovalResolver | null;
  private closed = false;
  /**
   * Serializes this runner's preferences read-modify-write handlers
   * ({@link handleProviderSetActive} / {@link handleProviderSetEnabled}).
   *
   * Invariant #5: a whole-file RMW store needs an atomic write PLUS a
   * per-instance promise-mutex. The atomic-write half lives in core's
   * `savePreferences`; the serialization half lives here because the
   * `disabledProviders` toggle reads the current set via `loadPreferences`
   * BEFORE handing the merged patch to `savePreferences` — that load→compute
   * step spans core's own critical section, so two overlapping toggles could
   * otherwise both read the same set and the second clobber the first. Running
   * the whole load→compute→save body under one mutex makes every prefs write
   * issued by this runner serialize. (Core would ideally expose a single
   * mutexed updater covering all callers; until it does, cross-process /
   * cross-runner prefs writes remain best-effort behind the atomic rename.)
   */
  private readonly prefsMutex = createMutex();

  constructor(
    private readonly session: Session,
    private readonly transport: TransportServer,
  ) {
    this.fallbackPermission = session.resolver;
    this.fallbackApproval = session.approvalResolver;
    this.installRoutingResolvers();
    this.transport.onConnection((t) => this.onConnection(t));
    this.logUnsub = session.log.subscribe((event) => this.broadcastEvent(event));
    // Mirror a log wipe to every attached client. Subscribing to the log's
    // clear listener (rather than broadcasting inside handleSessionReset)
    // covers BOTH reset paths — the session.reset RPC and a self-hosting
    // channel clearing the local log directly — so mirrors can never desync
    // against a wiped log whose next event restarts at seq 0.
    this.logClearUnsub = session.log.onClear(() =>
      this.broadcast(RunnerNotification.SessionReset, {}),
    );
    // Mirror active-mode changes to clients — covers both the SetMode RPC and a
    // mode handing off to another mode post-turn.
    this.modesUnsub = session.modes.onActiveChange(() => this.broadcastInfo());
    // Multiplex every open surface's output to all attached clients (v8). The
    // host emits one SurfaceDataMessage per frame; a client routes it to the
    // matching pane by surfaceId and ignores surfaces it isn't showing.
    this.surfacesUnsub = session.surfaces.onData((data) =>
      this.broadcast(RunnerNotification.SurfaceData, { data }),
    );
  }

  get address(): string {
    return this.transport.address;
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.logUnsub();
    this.logClearUnsub();
    this.modesUnsub();
    this.surfacesUnsub();
    void this.session.surfaces.closeAll();
    for (const client of this.clients) client.peer.close();
    this.clients.clear();
    await this.transport.close();
  }

  // --- connection lifecycle ------------------------------------------------

  private onConnection(transport: Transport): void {
    const peer = new JsonRpcPeer(transport);
    const client: ConnectedClient = {
      peer,
      role: 'unknown',
      attached: false,
      handlesPermission: false,
      handlesApproval: false,
      turns: new Set(),
    };
    this.clients.add(client);

    peer.handle(RunnerMethod.Attach, (raw) => this.handleAttach(client, raw));
    peer.handle(RunnerMethod.GetInfo, () => this.session.getInfo());
    peer.handle(RunnerMethod.RunTurn, (raw) => this.handleRunTurn(client, raw));
    peer.handle(RunnerMethod.Abort, (raw) => this.handleAbort(client, raw));
    peer.handle(RunnerMethod.SessionReset, () => this.handleSessionReset());
    peer.handle(RunnerMethod.SetResolver, (raw) => this.handleSetResolver(client, raw));
    peer.handle(RunnerMethod.ModeSetActive, (raw) => this.handleModeSetActive(raw));
    peer.handle(RunnerMethod.ProviderSetActive, (raw) => this.handleProviderSetActive(raw));
    peer.handle(RunnerMethod.ProviderSetEnabled, (raw) => this.handleProviderSetEnabled(raw));
    peer.handle(RunnerMethod.ProviderRefreshReady, () => this.handleProviderRefreshReady());
    peer.handle(RunnerMethod.ProviderConfigure, (raw) => this.handleProviderConfigure(raw));
    peer.handle(RunnerMethod.PermissionAddAllow, (raw) => this.handlePermissionAddAllow(raw));
    peer.handle(RunnerMethod.CommandRun, (raw) => this.handleCommandRun(raw));
    peer.handle(RunnerMethod.Transcribe, (raw) => this.handleTranscribe(raw));
    peer.handle(RunnerMethod.Synthesize, (raw) => this.handleSynthesize(raw));
    peer.handle(RunnerMethod.McpListServers, () => this.handleMcpListServers());
    peer.handle(RunnerMethod.McpEnableAndAttach, (raw) =>
      this.handleMcpEnableAndAttach(raw),
    );
    peer.handle(RunnerMethod.McpDetach, (raw) => this.handleMcpDetach(raw));
    peer.handle(RunnerMethod.WorkflowList, () => this.handleWorkflowList());
    peer.handle(RunnerMethod.WorkflowSetEnabled, (raw) =>
      this.handleWorkflowSetEnabled(raw),
    );
    peer.handle(RunnerMethod.WorkflowRun, (raw) => this.handleWorkflowRun(raw));
    peer.handle(RunnerMethod.WorkflowValidateDraft, (raw) =>
      this.handleWorkflowValidateDraft(raw),
    );
    peer.handle(RunnerMethod.WorkflowSave, (raw) => this.handleWorkflowSave(raw));
    peer.handle(RunnerMethod.WorkflowGetRun, (raw) => this.handleWorkflowGetRun(raw));
    peer.handle(RunnerMethod.WorkflowResume, (raw) => this.handleWorkflowResume(raw));
    peer.handle(RunnerMethod.SurfaceList, () => this.handleSurfaceList());
    peer.handle(RunnerMethod.SurfaceOpen, (raw) => this.handleSurfaceOpen(raw));
    peer.handle(RunnerMethod.SurfaceInput, (raw) => this.handleSurfaceInput(raw));
    peer.handle(RunnerMethod.SurfaceResize, (raw) => this.handleSurfaceResize(raw));
    peer.handle(RunnerMethod.SurfaceClose, (raw) => this.handleSurfaceClose(raw));

    peer.onClose(() => this.onDisconnect(client));
  }

  private onDisconnect(client: ConnectedClient): void {
    this.clients.delete(client);
    // Tear down any turns this client was driving - there's no one left to
    // answer their prompts or consume their output.
    for (const turnId of client.turns) {
      this.turnControllers.get(turnId)?.controller.abort('owning client disconnected');
    }
  }

  // --- request handlers ----------------------------------------------------

  private handleAttach(client: ConnectedClient, raw: unknown): AttachResult {
    const params = attachParamsSchema.parse(raw);
    // Tolerant negotiation: accept any client whose version is compatible with
    // our core session protocol (>= MIN_COMPATIBLE). All skew through v4 is
    // additive, so a newer client just won't call methods we lack, and an
    // older-but-compatible client never used the methods we added. Only a
    // client below the compatibility floor is genuinely broken — that is the
    // sole hard "mismatch" (a real stale daemon the desktop should replace).
    // The client gets our own version back in the result and gates
    // version-specific methods on it.
    if (params.protocolVersion < MIN_COMPATIBLE_PROTOCOL_VERSION) {
      throw new Error(
        `runner protocol mismatch: server v${RUNNER_PROTOCOL_VERSION}, client v${params.protocolVersion}`,
      );
    }
    client.role = params.role;
    client.attached = true;
    // Replay per the client's `replay` policy (v6; default 'full'). The start
    // seq is announced via `replay.start` BEFORE the loop so the client can
    // rebase its (empty) mirror — its `ingest` accepts only the next-expected
    // seq, so a partial replay without the rebase would drop every event and
    // permanently desync the mirror. `sinceSeq` predates `replay` and stays on
    // the wire for compatibility but is intentionally ignored (pre-v6 clients
    // can't rebase, so they always need the full replay). This loop is fully
    // synchronous, so no live event can interleave before it finishes - every
    // later event arrives exactly once via broadcast.
    const replay = params.replay ?? 'full';
    const total = this.session.log.length;
    const start =
      replay === 'full' ? 0 : replay === 'none' ? total : Math.max(0, total - replay.tail);
    client.peer.notify(RunnerNotification.ReplayStart, { fromSeq: start });
    for (const event of this.session.log.slice(start)) {
      client.peer.notify(RunnerNotification.Event, { event });
    }
    return {
      sessionId: this.session.id,
      protocolVersion: RUNNER_PROTOCOL_VERSION,
      info: this.session.getInfo(),
    };
  }

  private handleRunTurn(client: ConnectedClient, raw: unknown): RunTurnResult {
    const params = runTurnParamsSchema.parse(raw);
    // Honour a client-supplied id (v6) so the client's per-turn event filters
    // match the events the runner emits. A collision with an in-flight turn is
    // a client bug (or a cross-client hijack attempt) — reject it loudly
    // rather than letting two turns share one controller/owner entry.
    const turnId = params.turnId ? asTurnId(params.turnId) : newTurnId();
    if (this.turnControllers.has(turnId)) {
      throw new Error(
        `turn id ${turnId} is already in flight — client-supplied turn ids must be unique`,
      );
    }
    const controller = new AbortController();
    this.turnControllers.set(turnId, { controller, owner: client });
    client.turns.add(turnId);

    const opts = {
      turnId,
      signal: controller.signal,
      ...(params.model ? { model: params.model } : {}),
      ...(params.systemPrompt ? { systemPrompt: params.systemPrompt } : {}),
      ...(params.maxIterations ? { maxIterations: params.maxIterations } : {}),
      ...(params.attachments
        ? { attachments: params.attachments as ReadonlyArray<UserPromptAttachment> }
        : {}),
    };

    // Drive the turn in the background inside the per-turn scope. Events reach
    // clients via the log broadcast, so we only consume the iterable to run it
    // to completion and learn when it's done.
    void this.scope.run({ client, turnId }, async () => {
      let error: string | undefined;
      try {
        for await (const _event of this.session.runTurn(params.prompt, opts)) {
          void _event;
        }
      } catch (err) {
        error = err instanceof Error ? err.message : String(err);
      } finally {
        this.turnControllers.delete(turnId);
        client.turns.delete(turnId);
        this.broadcast(RunnerNotification.TurnComplete, {
          turnId,
          ...(error ? { error } : {}),
        });
        // A turn may have run registry-mutating tools (provider_add, mcp_add,
        // workflow_create, skill writes, …). Push the fresh snapshot so
        // attached clients (the desktop Settings panel) re-render without an
        // app restart. Once per turn — cheap relative to the turn itself.
        this.broadcastInfo();
      }
    });

    return { turnId };
  }

  private handleAbort(client: ConnectedClient, raw: unknown): Record<string, never> {
    const params = abortParamsSchema.parse(raw);
    const entry = this.turnControllers.get(params.turnId as TurnId);
    if (!entry) return {};
    if (entry.owner !== client) {
      // Cross-client abort is ALLOWED by design: multiple clients (TUI +
      // desktop) deliberately attach to the SAME shared session, so a user
      // aborting their own session's turn from another client is legitimate.
      // The audit's underlying concern - an unauthenticated local process
      // attaching at all - is addressed at the transport layer (0700 socket
      // directory, see unix-socket.ts), not by denying aborts here. We keep
      // an audit trail instead; MOXXY_RUNNER_STRICT_ABORT=1 opts into denial
      // for single-client deployments.
      this.session.logger.warn('cross-client abort', {
        turnId: params.turnId,
        ownerRole: entry.owner.role,
        abortingRole: client.role,
      });
      if (process.env.MOXXY_RUNNER_STRICT_ABORT === '1') {
        throw new Error(
          `turn ${params.turnId} was started by '${entry.owner.role}'; cross-client abort denied (MOXXY_RUNNER_STRICT_ABORT=1)`,
        );
      }
    }
    entry.controller.abort('client requested abort');
    return {};
  }

  /**
   * `/new` from any attached client. Aborts every in-flight turn (whoever
   * started it — the wipe is session-global), then clears the authoritative
   * log. The clear cascades: the log's clear listeners broadcast the
   * `session.reset` notification to all attached mirrors (wired in the
   * ctor) and truncate the persistence sidecar's JSONL. An aborted turn may
   * still flush a final event after the wipe; it lands in the fresh log at
   * seq 0+ and is broadcast AFTER the reset notification (single ordered
   * socket), so mirrors stay contiguous either way.
   */
  private handleSessionReset(): Record<string, never> {
    for (const entry of this.turnControllers.values()) {
      entry.controller.abort('session reset');
    }
    this.session.log.clear();
    return {};
  }

  private handleSetResolver(client: ConnectedClient, raw: unknown): Record<string, never> {
    const params = setResolverParamsSchema.parse(raw);
    if (params.permission !== undefined) client.handlesPermission = params.permission;
    if (params.approval !== undefined) client.handlesApproval = params.approval;
    return {};
  }

  private handleModeSetActive(raw: unknown): Record<string, never> {
    const { name } = modeSetActiveParamsSchema.parse(raw);
    // setActive fires onActiveChange → broadcastInfo (wired in the ctor), so
    // no explicit broadcast needed here.
    this.session.modes.setActive(name);
    return {};
  }

  private async handleProviderSetActive(raw: unknown): Promise<Record<string, never>> {
    const { name, config } = providerSetActiveParamsSchema.parse(raw);
    // Mirror the in-process picker: resolve credentials (the CLI stashes a
    // resolver on the session at boot), drop any cached instance, re-activate.
    const resolver = this.session.credentialResolver;
    const cfg = config ?? (resolver ? await resolver(name) : {});
    const def = this.session.providers.list().find((p) => p.name === name);
    if (def) this.session.providers.replace(def);
    this.session.providers.setActive(name, cfg);
    // Persist the pick to ~/.moxxy/preferences.json so it survives to the NEXT
    // freshly-spawned runner. Without this, a remote client (e.g. the desktop)
    // that switches provider only mutates THIS runner's in-memory state — so
    // spawning another runner (the desktop spawns one `moxxy serve` per
    // workspace) boots back on the default provider with no key, comes up
    // `connected` but provider-less, and bounces the user to "Connect a
    // provider". Mirrors the TUI / Telegram pickers, which already persist.
    // Best-effort: savePreferences swallows its own write errors and never
    // throws, so a read-only home can't fail the setActive RPC. Run under the
    // shared `prefsMutex` so this write serializes against the disabledProviders
    // RMW in handleProviderSetEnabled (invariant #5): a setActive racing a
    // toggle must not interleave with that handler's load→compute→save.
    void this.prefsMutex.run(() => savePreferences({ providerName: name }));
    this.broadcastInfo();
    return {};
  }

  private async handleProviderSetEnabled(raw: unknown): Promise<Record<string, never>> {
    const { name, enabled } = providerSetEnabledParamsSchema.parse(raw);
    if (!this.session.providers.list().some((p) => p.name === name)) {
      throw new Error(`Provider not registered: ${name}`);
    }
    // Throws when disabling the ACTIVE provider — surface that verbatim.
    this.session.providers.setEnabled(name, enabled);
    // Persist so the next boot's activation walk skips it (setup.ts seeds the
    // registry from this list). Read-merge so concurrent writers of other
    // preference fields aren't clobbered; best-effort like every prefs write.
    // The load→compute→save is run under `prefsMutex` so it serializes against
    // the other prefs-writing handler — without it, two overlapping toggles (or
    // a setActive racing a toggle) could both read the same `disabledProviders`
    // set and the second clobber the first (invariant #5).
    void this.prefsMutex.run(async () => {
      const prefs = await loadPreferences();
      const current = new Set(prefs.disabledProviders ?? []);
      if (enabled) current.delete(name);
      else current.add(name);
      await savePreferences({ disabledProviders: [...current] });
    });
    this.broadcastInfo();
    return {};
  }

  private async handleProviderRefreshReady(): Promise<Record<string, never>> {
    // Re-probe every registered provider's credentials (vault keys / env /
    // OAuth tokens) so a key the user just saved flips readiness without a
    // runner restart. The resolver is the same non-interactive probe boot
    // uses; absent resolver (bare test sessions) → leave the set untouched.
    const resolver = this.session.credentialResolver;
    if (resolver) {
      const ready = new Set<string>();
      const active = this.session.providers.getActiveName();
      if (active) ready.add(active);
      for (const p of this.session.providers.list()) {
        if (ready.has(p.name)) continue;
        try {
          await resolver(p.name);
          ready.add(p.name);
        } catch {
          // not ready — leave out
        }
      }
      this.session.readyProviders = ready;
    }
    this.broadcastInfo();
    return {};
  }

  private async handleProviderConfigure(raw: unknown): Promise<Record<string, never>> {
    const { name, patch } = providerConfigureParamsSchema.parse(raw);
    const admin = this.session.providerAdmin;
    if (!admin) throw new Error('provider admin not supported on this runner');
    await admin.configure(name, patch as Parameters<typeof admin.configure>[1]);
    this.broadcastInfo();
    return {};
  }

  private async handlePermissionAddAllow(raw: unknown): Promise<Record<string, never>> {
    const { name, reason } = permissionAddAllowParamsSchema.parse(raw);
    await this.session.permissions.addAllow({ name, ...(reason ? { reason } : {}) });
    return {};
  }

  private async handleCommandRun(raw: unknown): Promise<CommandRunResult> {
    const { name, args, channel } = commandRunParamsSchema.parse(raw);
    const cmd = this.session.commands.get(name);
    if (!cmd) return { kind: 'error', message: `unknown command: /${name}` };
    const result = await cmd.handler({
      channel,
      sessionId: this.session.id,
      args,
      session: this.session,
    });
    // A command may have changed registries (e.g. /model-ish plugins).
    this.broadcastInfo();
    return result;
  }

  private async handleTranscribe(raw: unknown): Promise<TranscribeResult> {
    const params = transcribeParamsSchema.parse(raw);
    const audio = new Uint8Array(Buffer.from(params.audio, 'base64'));
    const opts = {
      ...(params.mimeType ? { mimeType: params.mimeType } : {}),
      ...(params.language ? { language: params.language } : {}),
      ...(params.prompt ? { prompt: params.prompt } : {}),
    };
    // Build an ordered list of candidates: the active transcriber
    // first (if any), then every other registered one — that way an
    // "active but uncredentialled" transcriber (e.g. plain Whisper
    // without OPENAI_API_KEY) doesn't shadow an OAuth-backed one
    // that would actually succeed. Identical to what the TUI does
    // by hardcoding to Codex, but agnostic to transcriber name.
    const candidates = this.transcribeCandidates();
    if (candidates.length === 0) throw new Error('no active transcriber on the runner');
    let lastErr: unknown = new Error('no active transcriber on the runner');
    for (const name of candidates) {
      try {
        const transcriber = this.session.transcribers.setActive(name);
        const result = await transcriber.transcribe(audio, opts);
        // Surface the change so remote clients observe activeTranscriber
        // tracking the one that actually worked.
        this.broadcastInfo();
        return result;
      } catch (err) {
        lastErr = err;
      }
    }
    throw lastErr;
  }

  private async handleSynthesize(raw: unknown): Promise<SynthesizeResult> {
    const params = synthesizeParamsSchema.parse(raw);
    const synth = this.session.synthesizers.tryGetActive();
    if (!synth) throw new Error('no active synthesizer on the runner');
    const opts = {
      ...(params.voice ? { voice: params.voice } : {}),
      ...(params.language ? { language: params.language } : {}),
      ...(typeof params.rate === 'number' ? { rate: params.rate } : {}),
    };
    const result = await synth.synthesize(params.text, opts);
    return {
      audio: Buffer.from(result.audio).toString('base64'),
      mimeType: result.mimeType,
    };
  }

  /** Ordered candidate list for a transcribe call.
   *  - First the active one (if any) — respects an explicit host /
   *    user choice.
   *  - Then every other registered transcriber. */
  private transcribeCandidates(): ReadonlyArray<string> {
    const activeName = this.session.transcribers.getActiveName();
    const names = this.session.transcribers.list().map((d) => d.name);
    if (!activeName || !names.includes(activeName)) return names;
    return [activeName, ...names.filter((n) => n !== activeName)];
  }

  // --- MCP (delegates to session.mcpAdmin if the plugin is loaded) ----------

  private async handleMcpListServers(): Promise<unknown[]> {
    const admin = this.session.mcpAdmin;
    if (!admin) return [];
    return [...(await admin.listServers())];
  }

  private async handleMcpEnableAndAttach(
    raw: unknown,
  ): Promise<{ toolNames: ReadonlyArray<string> } | null> {
    const params = mcpEnableAndAttachParamsSchema.parse(raw);
    const admin = this.session.mcpAdmin;
    if (!admin) throw new Error('mcp admin not available on this runner');
    return admin.enableAndAttach(params.name);
  }

  private async handleMcpDetach(raw: unknown): Promise<boolean> {
    const params = mcpDetachParamsSchema.parse(raw);
    const admin = this.session.mcpAdmin;
    if (!admin) throw new Error('mcp admin not available on this runner');
    return admin.detach(params.name);
  }

  // --- Workflows (delegates to session.workflows if the plugin is loaded) ---

  private async handleWorkflowList(): Promise<unknown[]> {
    const view = this.session.workflows;
    if (!view) return [];
    return [...(await view.list())];
  }

  private async handleWorkflowSetEnabled(raw: unknown): Promise<void> {
    const params = workflowSetEnabledParamsSchema.parse(raw);
    const view = this.session.workflows;
    if (!view) throw new Error('workflows plugin not loaded');
    await view.setEnabled(params.name, params.enabled);
  }

  private async handleWorkflowRun(raw: unknown): Promise<unknown> {
    const params = workflowRunParamsSchema.parse(raw);
    const view = this.session.workflows;
    if (!view) throw new Error('workflows plugin not loaded');
    return view.run(params.name);
  }

  // --- Workflows builder (validate / save / getRun) ------------------------
  // Optional on the view (older hosts / pre-builder plugins lack them), so
  // feature-check and throw a clear error rather than calling undefined.

  private async handleWorkflowValidateDraft(raw: unknown): Promise<unknown> {
    const params = workflowValidateDraftParamsSchema.parse(raw);
    const view = this.session.workflows;
    if (!view?.validateDraft) throw new Error('workflows builder not supported on this runner');
    return view.validateDraft(params.yaml);
  }

  private async handleWorkflowSave(raw: unknown): Promise<unknown> {
    const params = workflowSaveParamsSchema.parse(raw);
    const view = this.session.workflows;
    if (!view?.save) throw new Error('workflows builder not supported on this runner');
    return view.save(params.yaml, params.previousName);
  }

  private async handleWorkflowGetRun(raw: unknown): Promise<unknown> {
    const params = workflowGetRunParamsSchema.parse(raw);
    const view = this.session.workflows;
    if (!view?.getRun) throw new Error('workflows builder not supported on this runner');
    return (await view.getRun(params.name)) ?? null;
  }

  // --- Workflows human-in-the-loop (resume a paused awaitInput run) ---------
  // v5. Optional on the view (older hosts lack it), so feature-check and throw a
  // clear error rather than calling undefined.
  private async handleWorkflowResume(raw: unknown): Promise<unknown> {
    const params = workflowResumeParamsSchema.parse(raw);
    const view = this.session.workflows;
    if (!view?.resume) throw new Error('workflow resume not supported on this runner');
    return view.resume(params.runId, params.reply);
  }

  // --- Surfaces (v8; delegate to the session's SurfaceHost) ----------------
  // Output streams back as `surface.data` notifications (subscribed in the
  // ctor). All degrade cleanly when no surface plugin is loaded: list → [],
  // open → throws a clear "no surface" error.

  private async handleSurfaceList(): Promise<unknown[]> {
    return [...(await this.session.surfaces.list())];
  }

  private async handleSurfaceOpen(raw: unknown): Promise<unknown> {
    const { kind } = surfaceOpenParamsSchema.parse(raw);
    return this.session.surfaces.open(kind);
  }

  private async handleSurfaceInput(raw: unknown): Promise<Record<string, never>> {
    const { surfaceId, message } = surfaceInputParamsSchema.parse(raw);
    await this.session.surfaces.input(surfaceId, message);
    return {};
  }

  private async handleSurfaceResize(raw: unknown): Promise<Record<string, never>> {
    const { surfaceId, size } = surfaceResizeParamsSchema.parse(raw);
    await this.session.surfaces.resize(surfaceId, size);
    return {};
  }

  private async handleSurfaceClose(raw: unknown): Promise<Record<string, never>> {
    const { surfaceId } = surfaceCloseParamsSchema.parse(raw);
    await this.session.surfaces.close(surfaceId);
    return {};
  }

  private broadcastInfo(): void {
    this.broadcast(RunnerNotification.InfoChanged, { info: this.session.getInfo() });
  }

  // --- resolver routing ----------------------------------------------------

  private installRoutingResolvers(): void {
    const permission: PermissionResolver = {
      name: 'runner-routing',
      check: (call, ctx) => this.resolvePermission(call, ctx),
    };
    this.session.setPermissionResolver(permission);

    const approval: ApprovalResolver = {
      name: 'runner-routing',
      confirm: (req) => this.resolveApproval(req),
    };
    this.session.setApprovalResolver(approval);

    // Redirect any later resolver installs into the fallback slots rather than
    // letting them replace the routing resolver. Without this, a self-hosting
    // TUI mounting after the runner started would overwrite routing, so an
    // attached client's approval prompt would surface on the host TUI.
    this.session.setApprovalResolver = (resolver: ApprovalResolver | null) => {
      this.fallbackApproval = resolver;
    };
    this.session.setPermissionResolver = (resolver: PermissionResolver) => {
      this.fallbackPermission = resolver;
    };
  }

  private async resolvePermission(
    call: PendingToolCall,
    ctx: PermissionContext,
  ): Promise<PermissionDecision> {
    const scope = this.scope.getStore();
    if (scope && scope.client.handlesPermission && !scope.client.peer.isClosed) {
      try {
        return await scope.client.peer.request<PermissionDecision>(RunnerMethod.PermissionCheck, {
          turnId: scope.turnId,
          call,
          ctx,
        });
      } catch {
        return { mode: 'deny', reason: 'permission client unavailable' };
      }
    }
    return this.fallbackPermission.check(call, ctx);
  }

  private async resolveApproval(request: ApprovalRequest): Promise<ApprovalDecision> {
    const scope = this.scope.getStore();
    if (scope) {
      if (scope.client.handlesApproval && !scope.client.peer.isClosed) {
        try {
          return await scope.client.peer.request<ApprovalDecision>(RunnerMethod.ApprovalConfirm, {
            turnId: scope.turnId,
            request,
          });
        } catch {
          return defaultApproval(request);
        }
      }
      // A scoped turn whose client doesn't handle approvals: don't pester an
      // unrelated fallback; take the default option (headless semantics).
      return defaultApproval(request);
    }
    // Unscoped turn (e.g. self-hosting TUI driving the session directly):
    // honour whatever resolver was installed before we wrapped the session.
    if (this.fallbackApproval) return this.fallbackApproval.confirm(request);
    return defaultApproval(request);
  }

  // --- fan-out -------------------------------------------------------------

  private broadcastEvent(event: MoxxyEvent): void {
    this.broadcast(RunnerNotification.Event, { event });
  }

  private broadcast(method: string, params: unknown): void {
    for (const client of this.clients) {
      if (client.attached && !client.peer.isClosed) client.peer.notify(method, params);
    }
  }
}

function defaultApproval(request: ApprovalRequest): ApprovalDecision {
  return { optionId: request.defaultOptionId ?? request.options[0]?.id ?? '' };
}

/**
 * Start a {@link RunnerServer} for `session`. Binds a unix-socket transport by
 * default (override with `socketPath`, or inject a `transport` for tests).
 */
export async function startRunnerServer(
  session: Session,
  opts: { readonly socketPath?: string; readonly transport?: TransportServer } = {},
): Promise<RunnerServer> {
  const transport =
    opts.transport ??
    (await createUnixSocketServer(opts.socketPath ?? runnerSocketPath(), session.logger));
  // DO NOT auto-activate any transcriber at boot. The TUI's
  // useVoiceInput depends on Codex specifically and would throw
  // "another transcriber is active" if we promoted something else
  // first. Active-transcriber selection is a per-client / per-flow
  // concern; the runner's handleTranscribe handles fallback at
  // request time instead.
  return new RunnerServer(session, transport);
}
