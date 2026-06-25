import type { EmittedEvent, LLMProvider, ModeContext, MoxxyEvent, RunTurnOptions } from '@moxxy/sdk';
import type { SessionRuntime } from './session-runtime.js';
import { createSubagentSpawner } from './subagents.js';

// `RunTurnOptions` now lives in `@moxxy/sdk` so the runner client (which has
// no `Session`) can reference it. Re-exported here to keep the historical
// `@moxxy/core` import path working.
export type { RunTurnOptions } from '@moxxy/sdk';

export async function* runTurn(
  session: SessionRuntime,
  prompt: string,
  opts: RunTurnOptions = {},
): AsyncIterable<MoxxyEvent> {
  // Mint the turnId first so the subscriber below can filter by it. Without
  // the filter, concurrent runTurn() calls on the same Session would each
  // observe every event from every other turn (the EventLog has one global
  // listener set), causing cross-talk for hosts like the HTTP channel that
  // serve multiple turns in parallel.
  // Use a caller-supplied turnId when present (the runner mints it up front so
  // it can return the id before the turn runs); otherwise mint one here.
  const turnId = opts.turnId ?? session.startTurn().turnId;

  const queue: MoxxyEvent[] = [];
  const waiters: Array<() => void> = [];
  let done = false;
  let completed = false;
  let strategyError: unknown = null;
  // A mode can ask (via ctx.requestModeSwitch) to hand off to another mode
  // once this turn finishes — applied after the strategy drains, below.
  let requestedModeSwitch: string | null = null;

  const wake = (): void => waiters.shift()?.();
  const unsubscribe = session.log.subscribe((event) => {
    if (event.turnId !== turnId) return;
    queue.push(event);
    wake();
  });

  // Generator-scoped controller so an early consumer return/throw (HTTP client
  // disconnect, channel teardown) can abort the in-flight strategy instead of
  // leaving it to run the whole agentic loop to completion in the background
  // (burning tokens, holding resources) while the abandoned `finally` blocks on
  // `strategyPromise`.
  const turnController = new AbortController();
  let strategyPromise: Promise<void> | null = null;

  try {
    await session.log.append({
      type: 'user_prompt',
      sessionId: session.id,
      turnId,
      source: 'user',
      text: prompt,
      ...(opts.attachments && opts.attachments.length > 0
        ? { attachments: opts.attachments }
        : {}),
      ...(opts.origin ? { origin: opts.origin } : {}),
    });

    // Resolve provider + model AFTER the prompt is recorded so a
    // missing/misconfigured provider doesn't silently discard the user's
    // prompt or orphan the turnId. On failure, append a structured error event
    // (channels see a normal failed turn) and rethrow.
    let provider: LLMProvider;
    let model: string;
    try {
      provider = session.providers.getActive();
      // Sticky model: prefer the explicit per-turn model, then the session's
      // last-resolved model (so a conversation keeps the model it was using
      // across turns), then the active provider's default.
      const resolvedModel = opts.model ?? session.lastResolvedModel ?? provider.models[0]?.id;
      if (!resolvedModel) {
        throw new Error(
          `Active provider '${provider.name}' has no models configured`,
        );
      }
      model = resolvedModel;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await session.log.append({
        type: 'error',
        sessionId: session.id,
        turnId,
        source: 'system',
        kind: 'fatal',
        message,
      });
      throw err;
    }
    // Record the resolution so out-of-band spawns (workflow triggers) can
    // inherit the conversation's current model. Last-writer-wins when turns
    // run concurrently — see the field's doc in SessionRuntime.
    session.lastResolvedModel = model;

    const strategy = session.modes.getActive();
    // Combine the session's signal, the per-turn one (if provided), and the
    // generator-scoped abandonment signal so any of them firing cancels the turn.
    const effectiveSignal = AbortSignal.any(
      opts.signal
        ? [session.signal, opts.signal, turnController.signal]
        : [session.signal, turnController.signal],
    );
    // The session's working dir + environment, mirrored onto the ModeContext
    // so the shared tool dispatcher can hand onToolCall hooks the real cwd/env
    // (path-based policy hooks gate on these) instead of empty placeholders.
    const appCtx = session.appContext();
    const ctx: ModeContext = {
      sessionId: session.id,
      turnId,
      cwd: appCtx.cwd,
      env: appCtx.env,
      services: appCtx.services,
      model,
      systemPrompt: opts.systemPrompt,
      provider,
      tools: session.tools,
      skills: session.skills,
      log: session.log,
      compactor: session.compactors.getActive(),
      cacheStrategy: session.cacheStrategies.getActive(),
      ...(session.elisionSettings ? { elision: session.elisionSettings } : {}),
      ...(session.lazyTools ? { lazyTools: true } : {}),
      // Reasoning preference (effort) — honored only by providers/models that
      // advertise `supportsReasoning` (gated in collectProviderStream).
      ...(session.reasoning ? { reasoning: session.reasoning } : {}),
      ...(session.loopGuard ? { loopGuard: session.loopGuard } : {}),
      permissions: session.resolver,
      ...(session.approvalResolver ? { approval: session.approvalResolver } : {}),
      hooks: session.dispatcher,
      pluginHost: session.pluginHost,
      signal: effectiveSignal,
      maxIterations: opts.maxIterations,
      subagents: createSubagentSpawner({
        parentSession: session,
        parentTurnId: turnId,
        parentSignal: effectiveSignal,
        parentModel: model,
      }),
      requestModeSwitch: (modeName: string) => {
        requestedModeSwitch = modeName;
      },
      emit: (event: EmittedEvent) => session.log.append(event),
    };

    const turnStartCtx = { ...appCtx, turnId, iteration: 0 };

    strategyPromise = (async () => {
      let started = false;
      try {
        await session.dispatcher.dispatchTurnStart(turnStartCtx);
        started = true;
        for await (const _ of strategy.run(ctx)) {
          // Events are surfaced via the log subscription above.
          void _;
        }
      } catch (err) {
        strategyError = err;
      } finally {
        // turnEnd must pair with turnStart even when the strategy throws/aborts,
        // so plugins that allocate turn-scoped state in onTurnStart (spans,
        // timers, token meters) always get the matching teardown.
        if (started) await session.dispatcher.dispatchTurnEnd(turnStartCtx);
        done = true;
        wake();
      }
    })();

    while (true) {
      while (queue.length > 0) yield queue.shift() as MoxxyEvent;
      if (done) break;
      await new Promise<void>((resolve) => waiters.push(resolve));
    }
    completed = true;
  } finally {
    unsubscribe();
    // If the consumer abandoned iteration early (broke out of the `for await`,
    // an outer error), `completed` is still false: abort the strategy so it
    // unwinds promptly instead of running the full loop in the background while
    // this `finally` blocks on `strategyPromise`.
    if (!completed) turnController.abort('runTurn iteration abandoned');
    if (strategyPromise) await strategyPromise;
    // Apply a mode hand-off the strategy requested, now that the turn has
    // fully drained. Only on clean completion: a thrown turn (strategyError) OR
    // an ABANDONED turn (consumer broke out early — `completed` is false, and a
    // mode that returns cleanly on `signal.aborted` leaves strategyError null)
    // keeps the current mode, so an unwatched/cancelled turn can't silently
    // flip the session into a different mode behind the user's back. An unknown
    // target is ignored so a bad name can't wedge the session. The registry's
    // setActive triggers the runner's InfoChanged broadcast, so channels see the
    // new mode.
    if (requestedModeSwitch && completed && !strategyError) {
      try {
        session.modes.setActive(requestedModeSwitch);
      } catch {
        /* unregistered target — leave the active mode unchanged */
      }
    }
  }

  if (strategyError) throw strategyError;
}

export async function collectTurn(
  session: SessionRuntime,
  prompt: string,
  opts: RunTurnOptions = {},
): Promise<ReadonlyArray<MoxxyEvent>> {
  const events: MoxxyEvent[] = [];
  for await (const event of runTurn(session, prompt, opts)) events.push(event);
  return events;
}
