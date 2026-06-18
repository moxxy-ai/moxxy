import { describe, expect, it } from 'vitest';
import { requirementSchema, type RequirementKind } from '@moxxy/sdk';
import { RequirementRegistry } from './requirements.js';
import { ToolRegistryImpl } from './registries/tools.js';
import { ProviderRegistry } from './registries/providers.js';
import { ModeRegistry } from './registries/modes.js';
import { CompactorRegistry } from './registries/compactors.js';
import { ChannelRegistryImpl } from './registries/channels.js';
import { AgentRegistry } from './registries/agents.js';
import { CommandRegistry } from './registries/commands.js';
import { TranscriberRegistry } from './registries/transcribers.js';
import { SynthesizerRegistry } from './registries/synthesizers.js';
import { silentLogger } from './logger.js';

const makeRequirements = () =>
  new RequirementRegistry({
    tools: new ToolRegistryImpl({ logger: silentLogger, cwd: '/tmp' }),
    providers: new ProviderRegistry(),
    modes: new ModeRegistry(),
    compactors: new CompactorRegistry(),
    channels: new ChannelRegistryImpl(),
    agents: new AgentRegistry(),
    commands: new CommandRegistry(),
    transcribers: new TranscriberRegistry(),
    synthesizers: new SynthesizerRegistry(),
  });

// Drive the exhaustiveness sweep off the SDK's zod enum rather than a hand-kept
// list, so a kind added to the union (and its schema) is automatically exercised
// here. `targetInfo` is a table (TARGET_DESCRIPTORS) plus two special cases
// (plugin/runtime); the `Record<Exclude<RequirementKind,'plugin'|'runtime'>,_>`
// type already makes a missing table entry a compile error — this loop keeps the
// runtime smoke honest alongside that guard.
const ALL_KINDS: ReadonlyArray<RequirementKind> = requirementSchema.shape.kind.options;

describe('RequirementRegistry.targetInfo exhaustiveness', () => {
  it('exercises every RequirementKind in the zod enum', () => {
    // Sanity: the enum still spells out the full known set (catches an enum that
    // accidentally shrank). Order-independent.
    expect([...ALL_KINDS].sort()).toEqual(
      [
        'agent',
        'channel',
        'command',
        'compactor',
        'mode',
        'plugin',
        'provider',
        'runtime',
        'synthesizer',
        'tool',
        'transcriber',
      ].sort(),
    );
  });

  it('resolves a check (never throws) for every RequirementKind', () => {
    const requirements = makeRequirements();
    for (const kind of ALL_KINDS) {
      // Routed through the public `check` API since targetInfo is private.
      // With nothing registered every kind reports a defined, blocking issue
      // (missing / not_ready) rather than hitting the assertNever default — i.e.
      // every kind has a table entry or special case backing it.
      const check = requirements.check([{ kind, name: `nonexistent-${kind}` }]);
      expect(check).toBeDefined();
      expect(check.issues).toHaveLength(1);
      expect(check.issues[0]?.requirement.kind).toBe(kind);
    }
  });
});
