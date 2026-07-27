import { createMutex, type Mutex, type PendingToolCall, type PermissionDecision } from '@moxxy/sdk';
import { PRIVATE_FILE_MODE, writeFileAtomic } from '@moxxy/sdk/server';
import { promises as fs } from 'node:fs';
import { posix } from 'node:path';
import { z } from 'zod';

/**
 * Flat shape used by the policy file and the engine's mutator API.
 * Different from SDK's `PermissionRule` (which uses a nested `pattern`).
 * The engine has its own type because the persisted format is intentionally
 * simple and stable.
 */
export interface PolicyRule {
  readonly name: string;
  /**
   * Map of tool-input field name → regex source string. Each value is compiled
   * with `new RegExp(value)` and tested with `.test(candidate)`, which is an
   * UNANCHORED (substring / partial) match by design: the pattern matches if it
   * occurs anywhere in the field's string form, not only when it spans the whole
   * value. This is a deliberate, stable contract — existing user permission
   * files rely on it, so it is never silently anchored.
   *
   * Consequence: an allow rule like `{ Read: { path: 'config' } }` matches
   * `/etc/passwd#config` and `~/.ssh/config-backup` too. A rule that wants a
   * FULL match must supply its own anchors, e.g. `'^/safe/dir/.*$'`. (Note this
   * differs from {@link nameMatches}, which anchors its glob with `^...$`
   * because a glob is a whole-name convention, not an author-supplied regex.)
   */
  readonly inputMatches?: Record<string, string>;
  /**
   * Field name to path PREFIX. Anchored and path-aware, unlike
   * {@link inputMatches}: `{ path: '/srv/app' }` matches `/srv/app/x` but not
   * `/srv/apple` and not `/tmp/srv/app`.
   *
   * Exists because the unanchored regex above is a trap for whoever writes an
   * organisation's policy. The obvious `{ Read: { path: '/etc' } }` reads like
   * "under /etc" and actually means "contains /etc anywhere", which as a DENY
   * rule over-blocks and as an ALLOW rule grants far more than intended. Paths
   * are normalised before comparison, so `..` cannot walk out of the prefix.
   */
  readonly inputPathPrefix?: Record<string, string>;
  /**
   * Field name to a glob, anchored whole-value. `*` matches within a path
   * segment, `**` across segments, `?` one character.
   */
  readonly inputGlob?: Record<string, string>;
  readonly reason?: string;
}

const policyRuleSchema = z.object({
  name: z.string(),
  inputMatches: z.record(z.string(), z.string()).optional(),
  inputPathPrefix: z.record(z.string(), z.string()).optional(),
  inputGlob: z.record(z.string(), z.string()).optional(),
  reason: z.string().optional(),
});

export const permissionPolicySchema = z.object({
  allow: z.array(policyRuleSchema).default([]),
  deny: z.array(policyRuleSchema).default([]),
});

export type PermissionPolicy = z.infer<typeof permissionPolicySchema>;

const emptyPolicy: PermissionPolicy = { allow: [], deny: [] };

/**
 * Upper bound on the candidate string a policy regex is tested against. The
 * permission check sits on the synchronous critical path of EVERY tool call and
 * runs author-supplied `inputMatches` patterns over MODEL-controlled tool input
 * (the model proposes the call). A pathological pattern (e.g. `(a+)+$`) over a
 * long model-supplied string can pin the event loop (ReDoS). No legitimate
 * permission match needs more than a few KB, so we truncate the candidate first
 * — bounding the worst-case backtracking work to a fixed input size. Truncation
 * only affects matches that depend on content past 8 KB, which a permission
 * pattern should never rely on.
 */
const MAX_MATCH_INPUT = 8192;

/**
 * Bounded cache of compiled regexes keyed by source string. `check()` walks every
 * rule per tool call and the patterns never change between mutations, so without
 * a cache a policy with N pattern rules recompiles N `RegExp`s on every one of M
 * tool calls. Caching keeps `.test` the only per-call work. A `null` value
 * memoizes an UNCOMPILABLE source so we don't re-throw on every check (the
 * stderr warning is still emitted per check by the caller, preserving the
 * documented fail-open/closed surfacing). Bounded to cap memory if a policy ever
 * carries an unbounded set of distinct patterns; eviction just recompiles.
 */
const MAX_REGEX_CACHE = 512;
const regexCache = new Map<string, RegExp | null>();

function compileRegex(source: string): RegExp | null {
  const cached = regexCache.get(source);
  if (cached !== undefined) return cached;
  let compiled: RegExp | null;
  try {
    compiled = new RegExp(source);
  } catch {
    compiled = null;
  }
  if (regexCache.size >= MAX_REGEX_CACHE) {
    const oldest = regexCache.keys().next().value;
    if (oldest !== undefined) regexCache.delete(oldest);
  }
  regexCache.set(source, compiled);
  return compiled;
}

export class PermissionEngine {
  private policy: PermissionPolicy;
  private policyPath: string | null;
  // Per-instance mutex. Mutators read-modify-write `this.policy` then persist;
  // without serialization two overlapping calls both read the same snapshot,
  // each append one rule, and the second write clobbers the first's rule.
  private mutex: Mutex = createMutex();

  constructor(policy: PermissionPolicy = emptyPolicy, policyPath: string | null = null) {
    this.policy = policy;
    this.policyPath = policyPath;
  }

  static async load(policyPath: string): Promise<PermissionEngine> {
    try {
      const raw = await fs.readFile(policyPath, 'utf8');
      const parsed = permissionPolicySchema.parse(JSON.parse(raw));
      return new PermissionEngine(parsed, policyPath);
    } catch (err) {
      if (isNodeError(err) && err.code === 'ENOENT') {
        return new PermissionEngine(emptyPolicy, policyPath);
      }
      throw err;
    }
  }

  /**
   * Rules from CONFIG, which the mutators never touch and `save()` never
   * writes. When they come from the system scope (with the path in `locked:`)
   * they are the operator's policy, and the point is that a user cannot get rid
   * of them: not by editing `~/.moxxy/permissions.json`, not by answering
   * "allow always", not by deleting the file.
   */
  private immutable: PermissionPolicy = emptyPolicy;

  /**
   * Install the config-supplied layer. Separate from `policy` because the two
   * have different owners and different lifetimes: this one is re-derived from
   * config on every boot, the other is a user file the agent writes to.
   */
  setImmutableRules(rules: PermissionPolicy): void {
    this.immutable = rules;
  }

  /** The config-supplied layer currently in force. */
  getImmutableRules(): PermissionPolicy {
    return this.immutable;
  }

  /**
   * Decision order, and each step is load-bearing:
   *   1. immutable deny:  the operator's policy wins over everything.
   *   2. file deny:       the user's own standing denials.
   *   3. immutable allow: an operator-granted exception.
   *   4. file allow:      "allow always" answers.
   *
   * Deny always precedes allow within a layer, and the immutable layer always
   * precedes the file. Checking the file first would let an "allow always"
   * answer, which the agent itself can provoke, silently defeat a rule the
   * operator pushed.
   */
  check(call: PendingToolCall): PermissionDecision | null {
    for (const rule of this.immutable.deny) {
      if (matchRule(rule, call, 'deny')) {
        return { mode: 'deny', reason: rule.reason ?? `Denied by managed policy: ${rule.name}` };
      }
    }
    for (const rule of this.policy.deny) {
      if (matchRule(rule, call, 'deny')) {
        return { mode: 'deny', reason: rule.reason ?? `Denied by policy: ${rule.name}` };
      }
    }
    for (const rule of this.immutable.allow) {
      if (matchRule(rule, call, 'allow')) {
        return { mode: 'allow', reason: rule.reason ?? `Allowed by managed policy: ${rule.name}` };
      }
    }
    for (const rule of this.policy.allow) {
      if (matchRule(rule, call, 'allow')) {
        return { mode: 'allow', reason: rule.reason ?? `Allowed by policy: ${rule.name}` };
      }
    }
    return null;
  }

  async addAllow(rule: PolicyRule): Promise<void> {
    return this.mutex.run(async () => {
      this.policy = {
        ...this.policy,
        allow: [...this.policy.allow, sanitizeRule(rule)],
      };
      await this.persist();
    });
  }

  async addDeny(rule: PolicyRule): Promise<void> {
    return this.mutex.run(async () => {
      this.policy = {
        ...this.policy,
        deny: [...this.policy.deny, sanitizeRule(rule)],
      };
      await this.persist();
    });
  }

  /** Remove every rule (allow + deny) whose name matches exactly. Returns the count removed. */
  async removeByName(name: string): Promise<number> {
    return this.mutex.run(async () => {
      const allowBefore = this.policy.allow.length;
      const denyBefore = this.policy.deny.length;
      this.policy = {
        allow: this.policy.allow.filter((r) => r.name !== name),
        deny: this.policy.deny.filter((r) => r.name !== name),
      };
      const removed = allowBefore - this.policy.allow.length + (denyBefore - this.policy.deny.length);
      if (removed > 0) await this.persist();
      return removed;
    });
  }

  async clear(): Promise<void> {
    return this.mutex.run(async () => {
      this.policy = { allow: [], deny: [] };
      await this.persist();
    });
  }

  private async persist(): Promise<void> {
    if (!this.policyPath) return;
    // The policy IS the security control. Owner-only: another local account
    // must not be able to read which tools this user has standing grants for.
    await writeFileAtomic(this.policyPath, JSON.stringify(this.policy, null, 2), {
      mode: PRIVATE_FILE_MODE,
    });
  }

  get policySnapshot(): PermissionPolicy {
    return this.policy;
  }
}

/** Strip undefined fields and copy `inputMatches` through so persistence preserves it. */
function sanitizeRule(rule: PolicyRule): PolicyRule {
  const out: PolicyRule = { name: rule.name };
  if (rule.inputMatches && Object.keys(rule.inputMatches).length > 0) {
    (out as { -readonly [K in keyof PolicyRule]: PolicyRule[K] }).inputMatches = { ...rule.inputMatches };
  }
  if (rule.reason !== undefined) {
    (out as { -readonly [K in keyof PolicyRule]: PolicyRule[K] }).reason = rule.reason;
  }
  return out;
}

/**
 * Evaluate a rule against a call. `intent` is the list the rule lives on so we
 * can fail in the safe direction when a pattern is uncompilable:
 *
 * - A DENY rule with an invalid `inputMatches` regex fails CLOSED — the bad
 *   pattern is treated as a match so a malformed deny rule (e.g. an unbalanced
 *   bracket like `rm -rf [`) keeps denying instead of silently becoming a no-op
 *   that lets dangerous commands through.
 * - An ALLOW rule with an invalid regex fails to match — it never over-grants.
 *
 * Either way the bad pattern is surfaced on stderr so the misconfiguration is
 * visible rather than silent.
 */
function matchRule(rule: PolicyRule, call: PendingToolCall, intent: 'allow' | 'deny'): boolean {
  if (!nameMatches(rule.name, call.name)) return false;
  if (rule.inputMatches) {
    const input = call.input as Record<string, unknown> | null;
    if (!input || typeof input !== 'object') return false;
    for (const [k, v] of Object.entries(rule.inputMatches)) {
      const candidate = stringifyCandidate(input[k]);
      // `inputMatches` values are UNANCHORED regexes by design: `.test` does a
      // substring/partial match, so the pattern matches if it occurs anywhere
      // in `candidate`. This is the documented, stable contract (see
      // PolicyRule.inputMatches) — never wrap it in `^(?:…)$`, as that would
      // silently break existing permission files. Authors who need a full
      // match anchor their own pattern with `^…$`.
      const re = compileRegex(v);
      if (re === null) {
        warnBadPattern(rule.name, k, v, intent, regexCompileError(v));
        // Uncompilable pattern: a deny rule must still deny (fail closed),
        // an allow rule must not grant (this field fails to match).
        if (intent === 'deny') continue;
        return false;
      }
      if (!re.test(candidate)) return false;
    }
  }
  if (rule.inputPathPrefix) {
    const input = call.input as Record<string, unknown> | null;
    if (!input || typeof input !== 'object') return false;
    for (const [k, prefix] of Object.entries(rule.inputPathPrefix)) {
      if (!pathHasPrefix(stringifyCandidate(input[k]), prefix)) return false;
    }
  }
  if (rule.inputGlob) {
    const input = call.input as Record<string, unknown> | null;
    if (!input || typeof input !== 'object') return false;
    for (const [k, glob] of Object.entries(rule.inputGlob)) {
      const re = compileGlob(glob);
      if (re === null) {
        // An uncompilable glob fails the same way a bad regex does: a deny
        // still denies, an allow does not grant.
        if (intent === 'deny') continue;
        return false;
      }
      if (!re.test(stringifyCandidate(input[k]))) return false;
    }
  }
  return true;
}

/**
 * Whether `candidate` sits at or under `prefix`, comparing path SEGMENTS.
 *
 * `/srv/app` must cover `/srv/app` and `/srv/app/x` but never `/srv/apple`, and
 * `..` must not walk out: `path.normalize` collapses the traversal before the
 * comparison, so `/srv/app/../../etc/passwd` is rejected. A relative candidate
 * is resolved against nothing, so it can only match a relative prefix, which is
 * the conservative reading.
 */
function pathHasPrefix(candidate: string, prefix: string): boolean {
  if (prefix.length === 0) return false;
  const c = normalizePath(candidate);
  const p = normalizePath(prefix);
  if (c === p) return true;
  return c.startsWith(p.endsWith('/') ? p : `${p}/`);
}

function normalizePath(value: string): string {
  // posix semantics on every platform: policies are written once and shipped to
  // a fleet, so a rule must not mean different things on Windows.
  const normalized = posix.normalize(value.replace(/\\/g, '/'));
  return normalized.length > 1 && normalized.endsWith('/') ? normalized.slice(0, -1) : normalized;
}

/**
 * Anchored glob to RegExp. `**` crosses path separators, `*` does not, `?` is
 * one non-separator character. Everything else is escaped, so a glob can never
 * smuggle in regex syntax.
 */
const globCache = new Map<string, RegExp | null>();

function compileGlob(glob: string): RegExp | null {
  const cached = globCache.get(glob);
  if (cached !== undefined) return cached;
  let out = '';
  for (let i = 0; i < glob.length; i++) {
    const ch = glob[i]!;
    if (ch === '*') {
      if (glob[i + 1] === '*') {
        out += '.*';
        i++;
      } else {
        out += '[^/]*';
      }
    } else if (ch === '?') {
      out += '[^/]';
    } else {
      out += ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }
  }
  let compiled: RegExp | null;
  try {
    compiled = new RegExp(`^${out}$`);
  } catch {
    compiled = null;
  }
  if (globCache.size >= MAX_REGEX_CACHE) {
    const oldest = globCache.keys().next().value;
    if (oldest !== undefined) globCache.delete(oldest);
  }
  globCache.set(glob, compiled);
  return compiled;
}

/**
 * Coerce a tool-input field to the string an `inputMatches` regex tests against.
 * Primitives use their natural string form (unchanged behaviour); a
 * structured field (object/array) is JSON-serialized so a rule can match its
 * shape (e.g. `inputMatches: { args: '"--force"' }`) instead of silently
 * seeing `[object Object]` and never matching. `null`/`undefined` → `''`.
 *
 * The result is truncated to {@link MAX_MATCH_INPUT} so a long model-controlled
 * field can't drive catastrophic regex backtracking on the tool-call hot path
 * (see MAX_MATCH_INPUT).
 */
function stringifyCandidate(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'object') {
    try {
      return capLength(JSON.stringify(value) ?? '');
    } catch {
      return capLength(String(value));
    }
  }
  return capLength(String(value));
}

function capLength(s: string): string {
  return s.length > MAX_MATCH_INPUT ? s.slice(0, MAX_MATCH_INPUT) : s;
}

/** Re-derive the compile error for an uncompilable source (off the hot path —
 * only when a rule's pattern is invalid) so `warnBadPattern` keeps its detail. */
function regexCompileError(source: string): unknown {
  try {
    new RegExp(source);
    return undefined;
  } catch (err) {
    return err;
  }
}

function warnBadPattern(
  ruleName: string,
  field: string,
  pattern: string,
  intent: 'allow' | 'deny',
  err: unknown,
): void {
  const detail = err instanceof Error ? err.message : String(err);
  const resolution =
    intent === 'deny'
      ? 'failing closed (rule still denies)'
      : 'this field cannot match (rule will not grant)';
  process.stderr.write(
    `moxxy: invalid regex in ${intent} permission rule "${ruleName}" ` +
      `(inputMatches.${field} = ${JSON.stringify(pattern)}): ${detail} — ${resolution}\n`,
  );
}

function nameMatches(pattern: string, candidate: string): boolean {
  if (pattern === candidate) return true;
  if (pattern.includes('*')) {
    // Bound the candidate before the glob-derived `.test` (the glob escapes all
    // metachars, so the only backtracking risk is sheer input length). The
    // source is fully escaped, so `compileRegex` always succeeds here; the cache
    // just avoids recompiling the same glob on every tool call.
    const source = '^' + pattern.split('*').map(escapeRe).join('.*') + '$';
    const re = compileRegex(source);
    return re !== null && re.test(capLength(candidate));
  }
  return false;
}

function escapeRe(s: string): string {
  return s.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
}

function isNodeError(e: unknown): e is NodeJS.ErrnoException {
  return e instanceof Error && 'code' in e;
}
