import { describe, expect, it } from 'vitest';
import type { RequirementKind } from '@moxxy/sdk';
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

// Every variant of the closed RequirementKind union. If a kind is added to the
// SDK union without a matching `targetInfo` case, the `assertNever` default in
// targetInfo turns the gap into a compile error — this list keeps the runtime
// smoke honest alongside that guard.
const ALL_KINDS: ReadonlyArray<RequirementKind> = [
  'plugin',
  'provider',
  'tool',
  'transcriber',
  'synthesizer',
  'mode',
  'compactor',
  'channel',
  'agent',
  'command',
  'runtime',
];

describe('RequirementRegistry.targetInfo exhaustiveness', () => {
  it('resolves a check (never throws) for every RequirementKind', () => {
    const requirements = makeRequirements();
    for (const kind of ALL_KINDS) {
      // Routed through the public `check` API since targetInfo is private.
      // With nothing registered every kind reports a defined, blocking issue
      // (missing / not_ready) rather than hitting the assertNever default.
      const check = requirements.check([{ kind, name: `nonexistent-${kind}` }]);
      expect(check).toBeDefined();
      expect(check.issues).toHaveLength(1);
      expect(check.issues[0]?.requirement.kind).toBe(kind);
    }
  });
});
