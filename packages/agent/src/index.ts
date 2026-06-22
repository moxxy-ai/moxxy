/**
 * `@moxxy/agent` — the batteries-included entry to moxxy.
 *
 * One install, one call. Where `@moxxy/core`'s {@link setupAgent} is the flexible,
 * block-agnostic factory (you bring the plugins), this package bundles the
 * default loop + the OpenAI and Anthropic providers behind drop-in **presets**:
 *
 *   import { setupAgent, openaiPreset } from '@moxxy/agent';
 *   const { ask } = setupAgent(openaiPreset({ apiKey: process.env.OPENAI_API_KEY }));
 *   console.log(await ask('Hello!'));
 *
 * A preset is just a pre-filled {@link AgentPreset}, so they compose — pass an
 * array to register several providers at once (the first is active; swap with
 * `agent.setProvider(name)`):
 *
 *   const agent = setupAgent([openaiPreset({ apiKey: a }), anthropicPreset({ apiKey: b })]);
 *   agent.setProvider('anthropic'); // for the next turn
 */

import type { AgentPreset } from '@moxxy/core';
import defaultModePlugin from '@moxxy/mode-default';
import openaiPlugin from '@moxxy/plugin-provider-openai';
import anthropicPlugin from '@moxxy/plugin-provider-anthropic';

export interface ProviderPresetOptions {
  /** API key. Defaults to the provider's conventional env var
   *  (`OPENAI_API_KEY` / `ANTHROPIC_API_KEY`). */
  readonly apiKey?: string;
  /** Override the model id (otherwise the provider's default catalog applies). */
  readonly model?: string;
}

export interface OpenAIPresetOptions extends ProviderPresetOptions {
  /** Point at an OpenAI-compatible endpoint (z.ai, xAI, Google, Ollama/local). */
  readonly baseURL?: string;
}

/**
 * Drop absent config fields so they don't override provider defaults.
 * Blank strings count as absent: an unset-but-present env var (`OPENAI_API_KEY=`,
 * or a templated `.env` leaving `OPENAI_API_KEY="   "`) would otherwise freeze
 * `apiKey: '   '`, defeating the provider's own env fallback (`'…' ?? x`
 * short-circuits to the blank string) and turning a clear no-key path into an
 * opaque 401 at the first turn. Trimming here keeps the no-key path live and
 * mirrors the providers' own `key.trim()` validation.
 */
function clean(config: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(config).filter(
      ([, v]) => v !== undefined && !(typeof v === 'string' && v.trim() === ''),
    ),
  );
}

/**
 * One-shop OpenAI (and OpenAI-compatible) preset: the default loop + the OpenAI
 * provider, configured + activated. `setupAgent(openaiPreset({ apiKey }))`.
 */
export function openaiPreset(opts: OpenAIPresetOptions = {}): AgentPreset {
  return {
    plugins: [defaultModePlugin, openaiPlugin],
    provider: {
      name: 'openai',
      config: clean({
        apiKey: opts.apiKey ?? process.env.OPENAI_API_KEY,
        model: opts.model,
        baseURL: opts.baseURL,
      }),
    },
  };
}

/**
 * One-shop Anthropic (Claude) preset: the default loop + the Anthropic provider,
 * configured + activated. `setupAgent(anthropicPreset({ apiKey }))`.
 */
export function anthropicPreset(opts: ProviderPresetOptions = {}): AgentPreset {
  return {
    plugins: [defaultModePlugin, anthropicPlugin],
    provider: {
      name: 'anthropic',
      config: clean({
        apiKey: opts.apiKey ?? process.env.ANTHROPIC_API_KEY,
        model: opts.model,
      }),
    },
  };
}

// Re-export the core entry + its types so an app needs only `@moxxy/agent`.
export {
  setupAgent,
  type Agent,
  type AgentPreset,
  type SetupAgentOptions,
  type MoxxyEvent,
  type Plugin,
  type ToolDef,
  type PermissionResolver,
} from '@moxxy/core';
