import { asSkillId, z } from '@moxxy/sdk';
import type {
  LLMProvider,
  ModeDef,
  ModelDescriptor,
  ProviderDef,
  ProviderInfo,
  Skill,
  SkillInfo,
  ToolDef,
  ToolInfo,
} from '@moxxy/sdk';

// --- snapshot -> display-object reconstruction --------------------------------
// The TUI reads display fields off these; behavioral fields (stream, run,
// handler, inputSchema) are stubbed because that work lives on the runner.

export function fakeProvider(name: string, models: ReadonlyArray<ModelDescriptor>): LLMProvider {
  return {
    name,
    models,
    stream() {
      throw new Error('provider streaming runs on the runner');
    },
    async countTokens() {
      throw new Error('token counting runs on the runner');
    },
  };
}

export function fakeProviderDef(info: ProviderInfo): ProviderDef {
  return {
    name: info.name,
    models: info.models,
    createClient: () => fakeProvider(info.name, info.models),
  };
}

export function fakeMode(name: string): ModeDef {
  return {
    name,
    run() {
      throw new Error('modes run on the runner');
    },
  };
}

export function fakeTool(info: ToolInfo): ToolDef {
  return {
    name: info.name,
    description: info.description,
    inputSchema: z.any(),
    ...(info.compact ? { compact: info.compact } : {}),
    handler() {
      throw new Error('tools execute on the runner');
    },
  };
}

export function fakeSkill(info: SkillInfo): Skill {
  return {
    id: asSkillId(info.id),
    path: '',
    scope: 'plugin',
    frontmatter: { name: info.name, description: '' },
    body: '',
  };
}
