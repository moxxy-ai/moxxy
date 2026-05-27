import type { PendingToolCall, PermissionDecision } from '@moxxy/sdk';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
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
  private writeChain: Promise<void> = Promise.resolve();

  constructor(policy: PermissionPolicy = emptyPolicy, policyPath: string | null = null) {
    this.policy = policy;
    this.policyPath = policyPath;
  }

  /** Run `fn` under the per-instance mutex (kept alive across rejections). */
  private serialize<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.writeChain.then(fn, fn);
    this.writeChain = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
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
      if (matchRule(rule, call)) {
        return { mode: 'deny', reason: rule.reason ?? `Denied by policy: ${rule.name}` };
      }
    }
    for (const rule of this.policy.allow) {
      if (matchRule(rule, call)) {
        return { mode: 'allow', reason: rule.reason ?? `Allowed by policy: ${rule.name}` };
      }
    }
    return null;
  }

  async addAllow(rule: PolicyRule): Promise<void> {
    return this.serialize(async () => {
      this.policy = {
        ...this.policy,
        allow: [...this.policy.allow, sanitizeRule(rule)],
      };
      await this.persist();
    });
  }

  async addDeny(rule: PolicyRule): Promise<void> {
    return this.serialize(async () => {
      this.policy = {
        ...this.policy,
        deny: [...this.policy.deny, sanitizeRule(rule)],
      };
      await this.persist();
    });
  }

  /** Remove every rule (allow + deny) whose name matches exactly. Returns the count removed. */
  async removeByName(name: string): Promise<number> {
    return this.serialize(async () => {
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
    return this.serialize(async () => {
      this.policy = { allow: [], deny: [] };
      await this.persist();
    });
  }

  private async persist(): Promise<void> {
    if (!this.policyPath) return;
    await fs.mkdir(path.dirname(this.policyPath), { recursive: true });
    // Crash-atomic write: tmp + rename.
    const tmp = `${this.policyPath}.tmp.${process.pid}.${Date.now()}`;
    await fs.writeFile(tmp, JSON.stringify(this.policy, null, 2));
    await fs.rename(tmp, this.policyPath);
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

function matchRule(rule: PolicyRule, call: PendingToolCall): boolean {
  if (!nameMatches(rule.name, call.name)) return false;
  if (rule.inputMatches) {
    const input = call.input as Record<string, unknown> | null;
    if (!input || typeof input !== 'object') return false;
    for (const [k, v] of Object.entries(rule.inputMatches)) {
      const candidate = String(input[k] ?? '');
      try {
        if (!new RegExp(v).test(candidate)) return false;
      } catch {
        if (candidate !== v) return false;
      }
    }
  }
  return true;
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
