import type {
  PendingToolCall,
  PermissionContext,
  PermissionDecision,
  PermissionResolver,
  PermissionRule,
  StandingAllowRule,
} from './permission.js';

export const autoAllowResolver: PermissionResolver = {
  name: 'auto-allow',
  async check(): Promise<PermissionDecision> {
    return { mode: 'allow', reason: 'auto-allow resolver (test mode)' };
  },
};

export const denyByDefaultResolver: PermissionResolver = {
  name: 'deny-by-default',
  async check(): Promise<PermissionDecision> {
    return { mode: 'deny', reason: 'No interactive resolver available in headless mode. Use --allow-tools or permissions.json.' };
  },
};

export interface CallbackResolverOptions {
  readonly name?: string;
  readonly callback: (call: PendingToolCall, ctx: PermissionContext) => Promise<PermissionDecision>;
}

export function createCallbackResolver(opts: CallbackResolverOptions): PermissionResolver {
  return {
    name: opts.name ?? 'callback',
    check: opts.callback,
  };
}

export function createAllowListResolver(toolNames: ReadonlyArray<string>): PermissionResolver {
  const allowed = new Set(toolNames);
  return {
    name: 'allow-list',
    async check(call) {
      if (allowed.has(call.name)) return { mode: 'allow_session', reason: 'allow-list', decidedNow: true };
      return { mode: 'deny', reason: `Tool '${call.name}' not in allow-list` };
    },
  };
}

export type PermissionPromptHandler = (
  call: PendingToolCall,
  ctx: PermissionContext,
) => Promise<PermissionDecision>;

export interface DeferredPermissionResolverOptions {
  readonly prompt: PermissionPromptHandler;
  readonly name?: string;
  readonly sessionAllows?: Set<string>;
}

export interface DeferredPermissionResolver extends PermissionResolver {
  /**
   * Resolve all in-flight prompts with `deny`. Call from a channel's `stop`
   * so a pending permission prompt doesn't hang forever when the host UI
   * unmounts (the TUI bug the audit flagged).
   */
  abortAll(reason?: string): void;
}

/**
 * Resolver for channels that defer permission decisions to an external UI
 * (Ink dialog, Telegram inline keyboard, web form). Wraps a `prompt`
 * callback with:
 *   - sessionAllows shortcut — legacy `allow_session` decisions skip later
 *     prompts for the same tool; decisions carrying `sessionScope` match only
 *     the selected input values (for example one file or one command).
 *   - in-flight tracking — `abortAll()` resolves pending prompts with
 *     `deny`, so the channel can shut down cleanly without hangs.
 */
export function createDeferredPermissionResolver(
  opts: DeferredPermissionResolverOptions,
): DeferredPermissionResolver {
  const sessionAllows = opts.sessionAllows ?? new Set<string>();
  const grants = createSessionGrants();
  const pending = new Set<(d: PermissionDecision) => void>();
  return {
    name: opts.name ?? 'deferred',
    async check(call, ctx) {
      if (sessionAllows.has(call.name) || grants.covers(call)) {
        return { mode: 'allow_session', reason: 'allow_session previously granted' };
      }
      const decision = await new Promise<PermissionDecision>((resolve) => {
        pending.add(resolve);
        opts.prompt(call, ctx).then(
          (d) => {
            pending.delete(resolve);
            resolve(d);
          },
          (err) => {
            pending.delete(resolve);
            resolve({ mode: 'deny', reason: err instanceof Error ? err.message : String(err) });
          },
        );
      });
      // allow_always also skips later prompts in this conversation; saving it
      // to ~/.moxxy/permissions.json is the channel's job (see alwaysAllowRule).
      grants.remember(call, decision, ctx);
      return decision.mode === 'deny' ? decision : { ...decision, decidedNow: true };
    },
    abortAll(reason = 'channel closed') {
      for (const r of pending) r({ mode: 'deny', reason });
      pending.clear();
    },
  };
}

/** What a conversation's "allow for this session" and "always allow" answers cover. */
export interface SessionGrants {
  covers(call: PendingToolCall): boolean;
  /** Remember an answer: the same request only when the answer or the tool narrows it, else the whole tool. */
  remember(call: PendingToolCall, decision: PermissionDecision, ctx: PermissionContext): void;
}

export function createSessionGrants(): SessionGrants {
  const tools = new Set<string>();
  const requests: Array<{ readonly inputKeys: ReadonlyArray<string>; readonly key: string }> = [];
  return {
    covers: (call) =>
      tools.has(call.name) || requests.some((grant) => grant.key === scopedGrantKey(call, grant.inputKeys)),
    remember(call, decision, ctx) {
      if (decision.mode !== 'allow_session' && decision.mode !== 'allow_always') return;
      const scope = decision.sessionScope ?? ctx.toolPermission?.sessionScope;
      if (scope) requests.push({ inputKeys: scope.inputKeys, key: scopedGrantKey(call, scope.inputKeys) });
      else tools.add(call.name);
    },
  };
}

/**
 * The rule an "Always allow" answer saves: the whole tool, or, for a tool that
 * narrows its grant to the same request, exactly that request, so a later
 * conversation is not let through for something nobody approved.
 */
export function alwaysAllowRule(call: PendingToolCall, ctx: PermissionContext): StandingAllowRule {
  const keys = ctx.toolPermission?.sessionScope?.inputKeys;
  if (!keys) return { name: call.name };
  const input = isRecord(call.input) ? call.input : {};
  return { name: call.name, inputEquals: Object.fromEntries(keys.map((key) => [key, input[key] ?? null])) };
}

function scopedGrantKey(call: PendingToolCall, inputKeys?: ReadonlyArray<string>): string {
  const input = isRecord(call.input) ? call.input : {};
  const keys = inputKeys ?? Object.keys(input).sort();
  try {
    return JSON.stringify([call.name, keys.map((key) => [key, input[key]])]);
  } catch {
    // Non-JSON tool input must never broaden a grant. Including the call id
    // makes this key single-use, so the next request prompts again.
    return JSON.stringify([call.name, 'unserializable', call.callId]);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Evaluate a tool's OWN declared {@link PermissionRule} against a call.
 *
 * Tools can ship a `permission` rule to express their author's policy — e.g.
 * `reload_skills` / `load_tool` declare `{ action: 'allow' }` because they're
 * safe, internal, idempotent operations that should never prompt. That rule
 * was previously stored on the ToolDef but never consulted, so in headless
 * runs (where the channel resolver denies by default) even these safe tools
 * were blocked. The session resolver now consults this BETWEEN the user's
 * `permissions.json` policy and the channel resolver, so:
 *
 *   user policy (deny/allow)  >  tool-declared rule  >  channel resolver
 *
 * Returns a decision for a matching `allow`/`deny` rule, or `null` to defer
 * (no rule, pattern didn't match, or `action: 'prompt'` — the interactive
 * resolver should handle those).
 */
export function evaluateToolRule(
  rule: PermissionRule | undefined,
  call: PendingToolCall,
): PermissionDecision | null {
  if (rule?.workspace) return null;
  if (!rule || !toolRuleMatches(rule, call)) return null;
  switch (rule.action) {
    case 'allow':
      return { mode: 'allow', reason: rule.reason ?? 'tool-declared allow' };
    case 'deny':
      return { mode: 'deny', reason: rule.reason ?? 'tool-declared deny' };
    case 'prompt':
      return null; // defer to the interactive resolver
  }
}

function toolRuleMatches(rule: PermissionRule, call: PendingToolCall): boolean {
  const p = rule.pattern;
  if (!p) return true; // no pattern → applies to every call of this tool
  if (p.name !== undefined && !patternMatch(p.name, call.name)) return false;
  if (p.inputMatches) {
    const input = (call.input ?? {}) as Record<string, unknown>;
    for (const [key, matcher] of Object.entries(p.inputMatches)) {
      if (!patternMatch(matcher, String(input[key] ?? ''))) return false;
    }
  }
  return true;
}

function patternMatch(pattern: string | RegExp, candidate: string): boolean {
  return pattern instanceof RegExp ? pattern.test(candidate) : pattern === candidate;
}
