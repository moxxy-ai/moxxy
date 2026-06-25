import { defineTool, z, type CategoryView } from '@moxxy/sdk';
import { PLUGIN_CATEGORY_KEYS } from '@moxxy/config';

export interface CategoryDefaultsDeps {
  /** Per-category active default + swappable items (the swap axis). */
  readonly categories: () => ReadonlyArray<CategoryView>;
  /**
   * Persist `plugins.<category>.default` to the user config AND apply it to the
   * live session (`setActive`). Bound in the CLI's builtins wiring.
   */
  readonly setCategoryDefault: (category: string, name: string) => Promise<void>;
}

const categoryEnum = z.enum(PLUGIN_CATEGORY_KEYS as unknown as [string, ...string[]]);

export function buildSetDefaultTool(deps: CategoryDefaultsDeps) {
  return defineTool({
    name: 'set_default',
    description:
      'Swap the active default for a plugin category (provider, mode, compactor, ' +
      'cacheStrategy, embedder, transcriber, synthesizer, workflowExecutor, ' +
      'viewRenderer, tunnelProvider, isolator, channel). Persists ' +
      '`plugins.<category>.default` to ~/.moxxy/config.yaml and applies it to the ' +
      'running session immediately where possible. The name must be a registered ' +
      'contribution (run list_defaults to see the options). Core defaults can be ' +
      'swapped but never removed — a missing default falls back to the protected floor.',
    inputSchema: z.object({
      category: categoryEnum.describe('The plugin category whose default to change.'),
      name: z
        .string()
        .min(1)
        .describe('Contribution name to make the default (e.g. provider `openai`, mode `goal`).'),
    }),
    permission: { action: 'prompt' },
    isolation: { capabilities: { fs: { write: ['~/.moxxy/config.yaml'] } } },
    handler: async ({ category, name }) => {
      await deps.setCategoryDefault(category, name);
      const view = deps.categories().find((c) => c.category === category);
      return { category, active: view?.active ?? name };
    },
  });
}

export function buildListDefaultsTool(deps: CategoryDefaultsDeps) {
  return defineTool({
    name: 'list_defaults',
    description:
      'List every plugin category with its active default and the available ' +
      'swappable contributions (each tagged whether it is the current default). ' +
      'Use before set_default to see the valid options per category.',
    inputSchema: z.object({}),
    permission: { action: 'allow' },
    handler: async () => ({ categories: deps.categories() }),
  });
}
