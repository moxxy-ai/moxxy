/**
 * `setupAgent` — the one-call ergonomic entry to the moxxy runtime.
 *
 * Constructing a {@link Session}, registering a mode + provider plugins + tools,
 * activating a provider, and calling {@link runTurn} is the standard boilerplate.
 * This wraps all of it in a single SYNCHRONOUS call and hands back a small
 * {@link Agent} you destructure:
 *
 *   import { setupAgent } from '@moxxy/core';
 *   import defaultMode from '@moxxy/mode-default';
 *   import openai from '@moxxy/plugin-provider-openai';
 *
 *   const { ask, stream, session } = setupAgent({
 *     plugins: [defaultMode, openai],
 *     provider: { name: 'openai', config: { apiKey: process.env.OPENAI_API_KEY } },
 *     tools: [myTool],
 *   });
 *
 *   console.log(await ask('Hello!'));               // final reply text (async)
 *   for await (const e of stream('Go on…')) { … }   // event stream (async generator)
 *
 * Two ways to run a turn: `stream()` is a proper async generator that YIELDS each
 * {@link MoxxyEvent} as it happens; `ask()`/`collect()` are async — the final
 * text, or every event. The methods close over the session (no `this`), so
 * destructuring is safe. `session` is the LIVE session — hot-change blocks
 * between turns through it (or the `setProvider`/`setMode`/`use`/`addTool` sugar).
 * It stays block-agnostic: you pass the provider/mode PLUGINS in, so `@moxxy/core`
 * never depends on a vendor.
 */

import type { MoxxyEvent, PermissionResolver, Plugin, RunTurnOptions, ToolDef } from '@moxxy/sdk';

import { Session, type SessionOptions } from './session.js';
import { runTurn, collectTurn } from './run-turn.js';
import { autoAllowResolver, denyByDefaultResolver } from './permissions/resolvers.js';

export interface SetupAgentOptions {
  /** Working directory the agent operates in. Defaults to `process.cwd()`. */
  readonly cwd?: string;
  /** Plugins to register up front — modes, providers, tool-packs, … (order kept). */
  readonly plugins?: readonly Plugin[];
  /** Tools to register directly (sugar over authoring a one-tool plugin). */
  readonly tools?: readonly ToolDef[];
  /** Activate a provider after registration: its registered `name` + the config
   *  its `createClient` needs (e.g. `{ apiKey }`). */
  readonly provider?: { readonly name: string; readonly config?: Record<string, unknown> };
  /** Permission policy: `'auto'` (approve every tool call — frictionless headless
   *  default), `'deny'` (refuse all), or a custom {@link PermissionResolver}. */
  readonly permissions?: 'auto' | 'deny' | PermissionResolver;
  /** Any other {@link SessionOptions} (logger, secretResolver, pluginLoader,
   *  pluginDiscoveryPaths, …). */
  readonly session?: Omit<SessionOptions, 'cwd' | 'permissionResolver'>;
}

export interface Agent {
  /** The underlying live {@link Session} — full control + hot-change escape hatch
   *  (`session.providers`, `session.tools`, `session.modes`, `session.pluginHost`). */
  readonly session: Session;

  /** Run one turn as an async generator, YIELDING each event as it happens:
   *  `for await (const e of stream(prompt)) …`. */
  stream(prompt: string, opts?: RunTurnOptions): AsyncGenerator<MoxxyEvent, void, void>;
  /** Run one turn; resolve with the final assistant text (`''` if none). */
  ask(prompt: string, opts?: RunTurnOptions): Promise<string>;
  /** Run one turn; resolve with every emitted event. */
  collect(prompt: string, opts?: RunTurnOptions): Promise<ReadonlyArray<MoxxyEvent>>;
  /** Discover + load plugins from `node_modules` (and `pluginDiscoveryPaths`).
   *  Async; resolves with this agent for chaining. */
  discover(): Promise<Agent>;

  // ---- hot-change sugar (mutates the live session; chainable) ----
  /** Register another plugin (mode / provider / tool-pack) on the live session. */
  use(plugin: Plugin): Agent;
  /** Register a tool on the live session. */
  addTool(tool: ToolDef): Agent;
  /** Remove a registered tool by name. */
  removeTool(name: string): Agent;
  /** Swap the active provider (and its config) for subsequent turns. */
  setProvider(name: string, config?: Record<string, unknown>): Agent;
  /** Swap the active loop strategy (mode) for subsequent turns. */
  setMode(name: string): Agent;
}

function resolvePermissions(p: SetupAgentOptions['permissions']): PermissionResolver {
  if (p === 'deny') return denyByDefaultResolver;
  if (p === undefined || p === 'auto') return autoAllowResolver;
  return p;
}

function finalText(events: ReadonlyArray<MoxxyEvent>): string {
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const e = events[i]!;
    if (e.type === 'assistant_message') return e.content;
  }
  return '';
}

/** A reusable, pre-filled chunk of {@link SetupAgentOptions} — e.g. a provider
 *  "preset" that bundles a provider plugin + the default mode + its config, so
 *  `setupAgent(openaiPreset({ apiKey }))` is a one-line drop-in. A preset is just
 *  an options object, so presets compose: pass an array and they merge. */
export type AgentPreset = SetupAgentOptions;

/** Merge an array of presets into one options object: plugins concatenate
 *  (de-duped by name, so two presets both bringing the default mode register it
 *  once), tools concatenate, and the FIRST preset that names a provider wins as
 *  the active one (the others are still registered, so you can `setProvider` to
 *  swap). cwd/permissions take the first set; session options shallow-merge. */
function mergePresets(presets: readonly SetupAgentOptions[]): SetupAgentOptions {
  const plugins: Plugin[] = [];
  const seen = new Set<string>();
  const tools: ToolDef[] = [];
  let provider: SetupAgentOptions['provider'];
  let cwd: string | undefined;
  let permissions: SetupAgentOptions['permissions'];
  let session: SetupAgentOptions['session'];
  for (const p of presets) {
    for (const pl of p.plugins ?? []) {
      if (seen.has(pl.name)) continue;
      seen.add(pl.name);
      plugins.push(pl);
    }
    if (p.tools) tools.push(...p.tools);
    if (!provider && p.provider) provider = p.provider;
    cwd ??= p.cwd;
    permissions ??= p.permissions;
    if (p.session) session = { ...session, ...p.session };
  }
  return { plugins, tools, provider, cwd, permissions, session };
}

/**
 * Build a ready-to-run {@link Agent}. Synchronous — destructure the result.
 * Accepts a full options object, a single {@link AgentPreset}, or an ARRAY of
 * presets that are merged (see {@link mergePresets}):
 *
 *   setupAgent(openaiPreset({ apiKey }))
 *   setupAgent([openaiPreset({ apiKey }), anthropicPreset({ apiKey })]) // both; openai active
 */
export function setupAgent(input: SetupAgentOptions | readonly SetupAgentOptions[] = {}): Agent {
  const opts = Array.isArray(input) ? mergePresets(input) : (input as SetupAgentOptions);
  const session = new Session({
    cwd: opts.cwd ?? process.cwd(),
    permissionResolver: resolvePermissions(opts.permissions),
    ...opts.session,
  });

  for (const plugin of opts.plugins ?? []) session.pluginHost.registerStatic(plugin);
  for (const tool of opts.tools ?? []) session.tools.register(tool);
  if (opts.provider) session.providers.setActive(opts.provider.name, opts.provider.config);

  const agent: Agent = {
    session,
    async *stream(prompt, runOpts) {
      yield* runTurn(session, prompt, runOpts);
    },
    async ask(prompt, runOpts) {
      return finalText(await collectTurn(session, prompt, runOpts));
    },
    collect(prompt, runOpts) {
      return collectTurn(session, prompt, runOpts);
    },
    async discover() {
      await session.pluginHost.discoverAndLoad();
      return agent;
    },
    use(plugin) {
      session.pluginHost.registerStatic(plugin);
      return agent;
    },
    addTool(tool) {
      session.tools.register(tool);
      return agent;
    },
    removeTool(name) {
      session.tools.unregister(name);
      return agent;
    },
    setProvider(name, config) {
      session.providers.setActive(name, config);
      return agent;
    },
    setMode(name) {
      session.modes.setActive(name);
      return agent;
    },
  };
  return agent;
}
