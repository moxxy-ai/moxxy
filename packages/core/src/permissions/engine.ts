import type { PendingToolCall, PermissionDecision, PermissionRule } from '@moxxy/sdk';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { z } from 'zod';

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

  async addAllow(rule: PermissionRule & { name: string }): Promise<void> {
    this.policy = {
      ...this.policy,
      allow: [...this.policy.allow, { name: rule.name, reason: rule.reason }],
    };
    await this.persist();
  }

  private async persist(): Promise<void> {
    if (!this.policyPath) return;
    await fs.mkdir(path.dirname(this.policyPath), { recursive: true });
    await fs.writeFile(this.policyPath, JSON.stringify(this.policy, null, 2));
  }

  get policySnapshot(): PermissionPolicy {
    return this.policy;
  }
}

interface PolicyRuleShape {
  name: string;
  inputMatches?: Record<string, string>;
  reason?: string;
}

function matchRule(rule: PolicyRuleShape, call: PendingToolCall): boolean {
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
