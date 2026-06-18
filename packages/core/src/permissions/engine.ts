import { createMutex, writeFileAtomic, type Mutex, type PendingToolCall, type PermissionDecision } from '@moxxy/sdk';
import { promises as fs } from 'node:fs';
import { z } from 'zod';

/**
 * Flat shape used by the policy file and the engine's mutator API.
 * Different from SDK's `PermissionRule` (which uses a nested `pattern`).
 * The engine has its own type because the persisted format is intentionally
 * simple and stable.
 */
export interface PolicyRule {
  readonly name: string;
  readonly inputMatches?: Record<string, string>;
  readonly reason?: string;
}

export const permissionPolicySchema = z.object({
  allow: z.array(z.object({
    name: z.string(),
    inputMatches: z.record(z.string(), z.string()).optional(),
    reason: z.string().optional(),
  })).default([]),
  deny: z.array(z.object({
    name: z.string(),
    inputMatches: z.record(z.string(), z.string()).optional(),
    reason: z.string().optional(),
  })).default([]),
});

export type PermissionPolicy = z.infer<typeof permissionPolicySchema>;

const emptyPolicy: PermissionPolicy = { allow: [], deny: [] };

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

  check(call: PendingToolCall): PermissionDecision | null {
    for (const rule of this.policy.deny) {
      if (matchRule(rule, call, 'deny')) {
        return { mode: 'deny', reason: rule.reason ?? `Denied by policy: ${rule.name}` };
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
    await writeFileAtomic(this.policyPath, JSON.stringify(this.policy, null, 2));
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
      const candidate = String(input[k] ?? '');
      let re: RegExp;
      try {
        re = new RegExp(v);
      } catch (err) {
        warnBadPattern(rule.name, k, v, intent, err);
        // Uncompilable pattern: a deny rule must still deny (fail closed),
        // an allow rule must not grant (this field fails to match).
        if (intent === 'deny') continue;
        return false;
      }
      if (!re.test(candidate)) return false;
    }
  }
  return true;
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
    const re = new RegExp('^' + pattern.split('*').map(escapeRe).join('.*') + '$');
    return re.test(candidate);
  }
  return false;
}

function escapeRe(s: string): string {
  return s.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
}

function isNodeError(e: unknown): e is NodeJS.ErrnoException {
  return e instanceof Error && 'code' in e;
}
