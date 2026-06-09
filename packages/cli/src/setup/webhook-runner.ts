import { runTurn, type Session } from '@moxxy/core';
import type { PermissionResolver } from '@moxxy/sdk';
import type { WebhookPromptRunner } from '@moxxy/plugin-webhooks';

/**
 * Bridge the webhooks plugin's prompt-runner contract to a live Session.
 *
 * v1 reuses the active session so webhook fires land in the visible
 * event log (same approach as the scheduler runner). The trigger's
 * `allowedTools` IS enforced here: when the list is non-empty, the fire
 * runs against a per-fire scoped view of the session whose tool registry
 * only exposes the listed tools and whose permission resolver denies
 * anything outside the list (allowed tools still flow through the
 * session's normal resolver chain — persisted policy rules included).
 * An empty `allowedTools` keeps today's contract: the fire sees the
 * session's full tool set under its ordinary permission rules.
 *
 * The scoping is per-fire (a fresh view object per `runPrompt` call), so
 * concurrent fires with different allow-lists — and concurrent ordinary
 * turns — never observe each other's restrictions. Nothing on the shared
 * Session is mutated. Hosts that want hard isolation per fire should
 * swap this for a child-session runner.
 */
export function buildWebhookRunner(session: Session): WebhookPromptRunner {
  return {
    runPrompt: async ({ prompt, model, allowedTools, triggerName }) => {
      const target = scopedSessionView(session, allowedTools, triggerName);
      let text = '';
      let lastError: string | null = null;
      try {
        for await (const event of runTurn(target, prompt, model ? { model } : {})) {
          if (event.type === 'assistant_message') {
            text = event.content;
            if (event.stopReason === 'error') lastError = 'turn ended with error stop reason';
          } else if (event.type === 'error') {
            lastError = event.message;
          }
        }
      } catch (err) {
        return { text, error: err instanceof Error ? err.message : String(err) };
      }
      return lastError ? { text, error: lastError } : { text };
    },
  };
}

/** The session shape `runTurn` consumes (core's `SessionRuntime`). */
type RunTurnSession = Parameters<typeof runTurn>[0];

/**
 * Build a read-through view of the session scoped to `allowedTools`.
 *
 * Two layers, both per-fire and side-effect free on the shared session:
 *  - a filtered tool registry, so the model never even sees tools outside
 *    the list (and `execute` rejects them as a backstop);
 *  - a wrapping permission resolver that hard-denies calls to tools
 *    outside the list and delegates allowed calls to the session's
 *    CURRENT resolver (read at check time, so a channel installing a new
 *    resolver mid-fire is honored and the persisted-policy wrap stays in
 *    the chain).
 *
 * An empty list returns the session unwrapped — full tool set, normal
 * permission flow (the documented contract for `allowedTools: []`).
 */
function scopedSessionView(
  session: Session,
  allowedTools: ReadonlyArray<string>,
  triggerName: string,
): RunTurnSession {
  if (allowedTools.length === 0) return session;
  const allowed = new Set(allowedTools);

  const denyReason = (name: string): string =>
    `Tool '${name}' is not in webhook trigger '${triggerName}' allowedTools`;

  const resolver: PermissionResolver = {
    name: `webhook-allowed-tools(${triggerName})`,
    async check(call, ctx) {
      if (!allowed.has(call.name)) {
        return { mode: 'deny', reason: denyReason(call.name) };
      }
      return session.resolver.check(call, ctx);
    },
    // The allow-list is POLICY, so it must also surface through the
    // prompt-free `policyCheck` probe — auto-approving modes (goal mode)
    // consult only this and skip `check`'s prompt path entirely. Without
    // it, a goal-mode webhook fire would auto-approve tools outside the
    // trigger's allowedTools.
    async policyCheck(call, ctx) {
      if (!allowed.has(call.name)) {
        return { mode: 'deny', reason: denyReason(call.name) };
      }
      return (await session.resolver.policyCheck?.(call, ctx)) ?? null;
    },
  };

  const parent = session.tools;
  const tools: Session['tools'] = {
    list: () => parent.list().filter((t) => allowed.has(t.name)),
    get: (name) => (allowed.has(name) ? parent.get(name) : undefined),
    has: (name) => allowed.has(name) && parent.has(name),
    register: (tool) => parent.register(tool),
    unregister: (name) => parent.unregister(name),
    execute: (name, input, signal, opts) => {
      if (!allowed.has(name)) return Promise.reject(new Error(denyReason(name)));
      return parent.execute(name, input, signal, opts);
    },
  };

  return {
    get id() {
      return session.id;
    },
    get log() {
      return session.log;
    },
    get signal() {
      return session.signal;
    },
    tools,
    get skills() {
      return session.skills;
    },
    get providers() {
      return session.providers;
    },
    get modes() {
      return session.modes;
    },
    get compactors() {
      return session.compactors;
    },
    get cacheStrategies() {
      return session.cacheStrategies;
    },
    resolver,
    get approvalResolver() {
      return session.approvalResolver;
    },
    get elisionSettings() {
      return session.elisionSettings;
    },
    get lazyTools() {
      return session.lazyTools;
    },
    get dispatcher() {
      return session.dispatcher;
    },
    get pluginHost() {
      return session.pluginHost;
    },
    startTurn: () => session.startTurn(),
    appContext: () => session.appContext(),
  };
}
