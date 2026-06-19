import type {
  MoxxyRequirement,
  RequirementCheck,
  RequirementIssue,
  RequirementKind,
  RequirementState,
  AgentDef,
  ChannelDef,
  CommandDef,
  CompactorDef,
  ModeDef,
  ProviderDef,
  ToolDef,
  TranscriberDef,
  SynthesizerDef,
} from '@moxxy/sdk';

export interface RequirementChecker {
  check(requirements: ReadonlyArray<MoxxyRequirement> | undefined): RequirementCheck;
}

export interface RequirementRegistryOptions {
  readonly tools: {
    get(name: string): ToolDef | undefined;
  };
  readonly providers: {
    list(): ReadonlyArray<ProviderDef>;
    getActiveName(): string | null;
  };
  readonly modes: {
    list(): ReadonlyArray<ModeDef>;
    getActive(): ModeDef;
  };
  readonly compactors: {
    list(): ReadonlyArray<CompactorDef>;
    getActive(): CompactorDef | null;
  };
  readonly channels: {
    get(name: string): ChannelDef | undefined;
  };
  readonly agents: {
    get(name: string): AgentDef | undefined;
  };
  readonly commands: {
    get(name: string): CommandDef | undefined;
  };
  readonly transcribers: {
    list(): ReadonlyArray<TranscriberDef>;
    getActiveName(): string | null;
  };
  readonly synthesizers: {
    list(): ReadonlyArray<SynthesizerDef>;
    getActiveName(): string | null;
  };
}

interface RegisteredPlugin {
  readonly name: string;
  readonly version: string;
}

interface TargetInfo {
  readonly kind: RequirementKind;
  readonly name: string;
  readonly version?: string;
  readonly active: boolean;
}

/**
 * Per-kind recipe for {@link RequirementRegistry.targetInfo}. Every kind that
 * resolves against a registry on `opts` differs only in two orthogonal aspects,
 * so we table them rather than repeat the same `lookup -> {kind,name,active}`
 * shape once per case:
 *   - `present`  — does a def by this name exist? (`registry.get` or
 *                  `list().some`, depending on the registry base)
 *   - `active`   — is this the currently-active one? (a `getActiveName() === name`
 *                  / `getActive()?.name === name` check, or always-true for kinds
 *                  with no active/inactive distinction like tool/channel/agent)
 *
 * None of these kinds track a version (only `plugin` does, and it is
 * special-cased — see {@link RequirementRegistry.targetInfo}), so a `version`
 * aspect is deliberately omitted here. `runtime` is handled by `checkRuntime`
 * before `targetInfo` is reached and so also has no descriptor.
 */
interface TargetDescriptor {
  /** Whether a def with `name` is registered for this kind. */
  readonly present: (opts: RequirementRegistryOptions, name: string) => boolean;
  /** Whether the registered def is the currently-active one. */
  readonly active: (opts: RequirementRegistryOptions, name: string) => boolean;
}

/** Active for kinds with no active/inactive distinction (tool/channel/agent/command). */
const ALWAYS_ACTIVE = (): true => true;

export class RequirementRegistry {
  private readonly runtime = new Map<string, RequirementState>();
  private readonly plugins = new Map<string, RegisteredPlugin>();

  constructor(private readonly opts: RequirementRegistryOptions) {}

  registerPlugin(name: string, version: string): void {
    this.plugins.set(name, { name, version });
  }

  unregisterPlugin(name: string): void {
    this.plugins.delete(name);
  }

  setRuntime(name: string, state: RequirementState = 'ready'): void {
    this.runtime.set(name, state);
  }

  clearRuntime(name: string): void {
    this.runtime.delete(name);
  }

  check(requirements: ReadonlyArray<MoxxyRequirement> | undefined): RequirementCheck {
    const issues: RequirementIssue[] = [];
    for (const requirement of requirements ?? []) {
      const issue = this.checkOne(requirement);
      if (issue) issues.push(issue);
    }
    const blocking = issues.filter((issue) => !issue.requirement.optional);
    return { ready: blocking.length === 0, issues };
  }

  /**
   * Convenience: check whether a single named target is present and (if
   * its kind has an active/inactive distinction) currently active.
   * Equivalent to `check([{ kind, name, state: 'active' }])`.
   */
  isReady(kind: RequirementKind, name: string): RequirementCheck {
    return this.check([{ kind, name, state: 'active' }]);
  }

  private checkOne(requirement: MoxxyRequirement): RequirementIssue | null {
    if (requirement.kind === 'runtime') return this.checkRuntime(requirement);

    const target = this.targetInfo(requirement.kind, requirement.name);
    if (!target) {
      return issue(requirement, 'missing', `Required ${label(requirement.kind)} is not registered: ${requirement.name}`);
    }

    // `version` is only resolvable for the `plugin` kind (the sole kind whose
    // `targetInfo` populates a version — see {@link targetInfo}). The SDK type
    // permits `version` on every kind, so without this gate a `version` on any
    // non-plugin kind would compare against an always-undefined `target.version`
    // and report a permanent, spurious `version_mismatch` (target shown as
    // `(unknown)`) even though the target is present and active.
    if (requirement.kind === 'plugin' && requirement.version && target.version !== requirement.version) {
      return issue(
        requirement,
        'version_mismatch',
        `Required ${label(requirement.kind)} has version ${target.version ?? '(unknown)'}, expected ${requirement.version}: ${requirement.name}`,
      );
    }

    const state = requirement.state ?? 'registered';
    if ((state === 'active' || state === 'ready') && !target.active) {
      return issue(requirement, 'inactive', `Required ${label(requirement.kind)} is not active: ${requirement.name}`);
    }

    return null;
  }

  private checkRuntime(requirement: MoxxyRequirement): RequirementIssue | null {
    const state = requirement.state ?? 'ready';
    const actual = this.runtime.get(requirement.name);
    if (actual !== state) {
      return issue(requirement, 'not_ready', `Required runtime is not ready: ${requirement.name}`);
    }
    return null;
  }

  private targetInfo(kind: RequirementKind, name: string): TargetInfo | null {
    // `plugin` resolves against this instance's private registration map (not a
    // registry on `opts`) and is the only kind carrying a version, so it stays a
    // special case rather than being contorted into the shared table.
    if (kind === 'plugin') {
      const plugin = this.plugins.get(name);
      return plugin ? { kind, name, version: plugin.version, active: true } : null;
    }
    // `runtime` never reaches here — `checkOne` routes it to `checkRuntime` first.
    if (kind === 'runtime') return null;

    // Every remaining kind has a table entry: `TARGET_DESCRIPTORS` is a total
    // `Record` over `Exclude<RequirementKind, 'plugin' | 'runtime'>`, so a kind
    // added to the union without an entry is a compile error (the table-driven
    // replacement for the old switch's `assertNever` default).
    const descriptor = TARGET_DESCRIPTORS[kind];
    if (!descriptor.present(this.opts, name)) return null;
    return { kind, name, active: descriptor.active(this.opts, name) };
  }
}

/**
 * Lookup table backing {@link RequirementRegistry.targetInfo} for every
 * registry-backed {@link RequirementKind}. `plugin` (private map + version) and
 * `runtime` (handled before `targetInfo`) are intentionally absent and dealt
 * with as special cases; the `Partial`-free `Record` keyed on the remaining
 * kinds keeps the set exhaustive (a new kind is a compile error until listed).
 */
const TARGET_DESCRIPTORS: Record<
  Exclude<RequirementKind, 'plugin' | 'runtime'>,
  TargetDescriptor
> = {
  provider: {
    present: (opts, name) => opts.providers.list().some((p) => p.name === name),
    active: (opts, name) => opts.providers.getActiveName() === name,
  },
  tool: {
    present: (opts, name) => opts.tools.get(name) !== undefined,
    active: ALWAYS_ACTIVE,
  },
  transcriber: {
    present: (opts, name) => opts.transcribers.list().some((t) => t.name === name),
    active: (opts, name) => opts.transcribers.getActiveName() === name,
  },
  synthesizer: {
    present: (opts, name) => opts.synthesizers.list().some((s) => s.name === name),
    active: (opts, name) => opts.synthesizers.getActiveName() === name,
  },
  mode: {
    present: (opts, name) => opts.modes.list().some((m) => m.name === name),
    active: (opts, name) => activeModeName(opts.modes) === name,
  },
  compactor: {
    present: (opts, name) => opts.compactors.list().some((c) => c.name === name),
    active: (opts, name) => opts.compactors.getActive()?.name === name,
  },
  channel: {
    present: (opts, name) => opts.channels.get(name) !== undefined,
    active: ALWAYS_ACTIVE,
  },
  agent: {
    present: (opts, name) => opts.agents.get(name) !== undefined,
    active: ALWAYS_ACTIVE,
  },
  command: {
    present: (opts, name) => opts.commands.get(name) !== undefined,
    active: ALWAYS_ACTIVE,
  },
};

function issue(
  requirement: MoxxyRequirement,
  code: RequirementIssue['code'],
  message: string,
): RequirementIssue {
  return {
    requirement,
    code,
    message,
    ...(requirement.hint ? { hint: requirement.hint } : {}),
  };
}

function label(kind: RequirementKind): string {
  return kind;
}

function activeModeName(modes: RequirementRegistryOptions['modes']): string | null {
  try {
    return modes.getActive().name;
  } catch {
    return null;
  }
}
