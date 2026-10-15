/**
 * OpenCode's permission rules, as `opencode debug agent <name>` reports them:
 * an ordered list in which the last rule matching a permission and input wins.
 */
export interface OpenCodeRule {
  readonly permission: string;
  readonly pattern: string;
  readonly action: 'allow' | 'ask' | 'deny';
}

type Action = OpenCodeRule['action'];

/** Reads the rules of one of the person's OpenCode agents; `undefined` when OpenCode cannot say. */
export type ReadAgentRules = (opts: { readonly cwd: string; readonly agent: string }) => Promise<ReadonlyArray<OpenCodeRule> | undefined>;

/** Permissions whose rules take an input pattern (a command, a path). */
const PATTERNED = ['edit', 'bash'] as const;
/** Permissions with one action for every input. */
const UNPATTERNED = ['webfetch', 'websearch'] as const;

/** Whether OpenCode edits files and runs commands without asking anyone. */
export function runsWithoutAsking(rules: ReadonlyArray<OpenCodeRule>): boolean {
  return PATTERNED.every((permission) => anyInput(rules, permission) === 'allow');
}

/**
 * Whether the person's own OpenCode runs without asking in `cwd`, from its
 * default `build` agent's rules; `undefined` when OpenCode cannot be asked.
 */
export async function openCodeOwnAutoApprove(cwd: string, readRules: ReadAgentRules): Promise<boolean | undefined> {
  const rules = await readRules({ cwd, agent: 'build' }).catch(() => undefined);
  return rules ? runsWithoutAsking(rules) : undefined;
}

/**
 * The permission config that makes OpenCode ask before what it would do on its
 * own. Each permission's rules are repeated in their order with every allow
 * turned into an ask, so what the person denied stays denied. Given as the
 * agent's own permissions, they come after every other rule and win.
 */
export function askingRules(rules: ReadonlyArray<OpenCodeRule>): Record<string, Action | Record<string, Action>> {
  const config: Record<string, Action | Record<string, Action>> = {};
  for (const permission of PATTERNED) {
    const patterns = new Map<string, Action>();
    for (const rule of rules) {
      if (rule.permission !== permission && !(rule.pattern === '*' && matches(rule.permission, permission))) continue;
      // An earlier rule for the same pattern never wins over this one.
      patterns.delete(rule.pattern);
      patterns.set(rule.pattern, asked(rule.action));
    }
    if (!patterns.has('*')) patterns.set('*', 'ask');
    config[permission] = Object.fromEntries(patterns);
  }
  for (const permission of UNPATTERNED) config[permission] = asked(anyInput(rules, permission) ?? 'allow');
  return config;
}

/**
 * `OPENCODE_CONFIG_CONTENT` for an OpenCode that asks: the agent's permissions,
 * nothing written to disk. Inline config the person already passes is kept;
 * its rules are already among those read, so this agent's permissions replace them.
 */
export function askingConfig(agent: string, rules: ReadonlyArray<OpenCodeRule>, inline?: string): string {
  let config: { agent?: Record<string, Record<string, unknown>> } & Record<string, unknown> = {};
  try {
    const parsed: unknown = inline ? JSON.parse(inline) : {};
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) config = parsed as typeof config;
  } catch {
    // OpenCode skips inline config it cannot read; so does Moxxy.
  }
  const agents = config.agent ?? {};
  return JSON.stringify({ ...config, agent: { ...agents, [agent]: { ...agents[agent], permission: askingRules(rules) } } });
}

/**
 * Whether an ask is OpenCode's `external_directory`, which it puts to the
 * person even on its defaults: about a file it names the parent folder
 * (`parentDir`), about a command the folders (`directories`).
 */
export function asksOutsideProject(rawInput: unknown): boolean {
  if (typeof rawInput !== 'object' || rawInput === null) return false;
  const input = rawInput as Record<string, unknown>;
  return typeof input.parentDir === 'string' || Array.isArray(input.directories);
}

/** The action for an input no narrower rule names. */
function anyInput(rules: ReadonlyArray<OpenCodeRule>, permission: string): Action | undefined {
  return rules.findLast((rule) => rule.pattern === '*' && matches(rule.permission, permission))?.action;
}

function asked(action: Action): Action {
  return action === 'allow' ? 'ask' : action;
}

function matches(pattern: string, name: string): boolean {
  if (!pattern.includes('*')) return pattern === name;
  const source = pattern.split('*').map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*');
  return new RegExp(`^${source}$`).test(name);
}
