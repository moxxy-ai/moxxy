import { buildSynthesizeSkillPlugin, runTurn, type Session } from '@moxxy/core';
import type { Plugin } from '@moxxy/sdk';
import type { MoxxyConfig } from '@moxxy/config';
import { anthropicPlugin } from '@moxxy/plugin-provider-anthropic';
import { openaiPlugin } from '@moxxy/plugin-provider-openai';
import { openaiCodexPlugin } from '@moxxy/plugin-provider-openai-codex';
import { builtinToolsPlugin } from '@moxxy/tools-builtin';
import { toolUseLoopPlugin } from '@moxxy/loop-tool-use';
import { planExecuteLoopPlugin } from '@moxxy/loop-plan-execute';
import { bmadLoopPlugin } from '@moxxy/loop-bmad';
import { summarizeCompactorPlugin } from '@moxxy/compactor-summarize';
import { BUILTIN_SKILLS_DIR } from '@moxxy/skills-builtin';
import {
  buildMemoryConsolidatePlugin,
  type MemoryStore,
} from '@moxxy/plugin-memory';
import { buildTelegramPlugin } from '@moxxy/plugin-telegram';
import { buildMcpAdminPluginWithApi, type McpAdminApi } from '@moxxy/plugin-mcp';
import { cliPlugin } from '@moxxy/plugin-cli';
import { httpChannelPlugin } from '@moxxy/plugin-channel-http';
import { browserPlugin } from '@moxxy/plugin-browser';
import { buildSubagentsPlugin } from '@moxxy/plugin-subagents';
import { buildPluginsAdminPlugin } from '@moxxy/plugin-plugins-admin';
import { commandsPlugin } from '@moxxy/plugin-commands';
import { computerControlPlugin } from '@moxxy/plugin-computer-control';
import { buildOauthPlugin } from '@moxxy/plugin-oauth';
import type { VaultStore } from '@moxxy/plugin-vault';
import {
  buildSchedulerPlugin,
  type SchedulerPoller,
  type ScheduleStore,
  type SchedulePromptRunner,
} from '@moxxy/plugin-scheduler';

export interface BuiltinEntry {
  readonly name: string;
  readonly plugin: Plugin;
}

export interface BuildBuiltinsArgs {
  readonly session: Session;
  readonly rawConfig: MoxxyConfig;
  readonly vault: VaultStore;
  readonly vaultPlugin: Plugin;
  readonly memory: MemoryStore;
  readonly memoryPlugin: Plugin;
  readonly schedulerRunner: SchedulePromptRunner;
  readonly logger: { warn(msg: string, meta?: Record<string, unknown>): void };
}

export interface BuiltBuiltinsCore {
  readonly entries: ReadonlyArray<BuiltinEntry>;
  readonly scheduler: { readonly store: ScheduleStore; readonly poller: SchedulerPoller };
}

/**
 * Assemble the static builtin plugin list (everything except the
 * config plugin, which needs the rest as input). The returned `scheduler`
 * handle is surfaced upstream so the `moxxy schedule …` subcommands
 * can drive the store/poller without going through a model turn.
 */
export function buildBuiltinsCore(args: BuildBuiltinsArgs): BuiltBuiltinsCore {
  const { session, rawConfig, vault, vaultPlugin, memory, memoryPlugin, schedulerRunner, logger } = args;

  const entries: BuiltinEntry[] = [
    { name: '@moxxy/plugin-provider-anthropic', plugin: anthropicPlugin },
    { name: '@moxxy/plugin-provider-openai', plugin: openaiPlugin },
    { name: '@moxxy/plugin-provider-openai-codex', plugin: openaiCodexPlugin },
    { name: '@moxxy/tools-builtin', plugin: builtinToolsPlugin },
    { name: '@moxxy/loop-tool-use', plugin: toolUseLoopPlugin },
    { name: '@moxxy/loop-plan-execute', plugin: planExecuteLoopPlugin },
    { name: '@moxxy/loop-bmad', plugin: bmadLoopPlugin },
    { name: '@moxxy/compactor-summarize', plugin: summarizeCompactorPlugin },
    { name: '@moxxy/plugin-vault', plugin: vaultPlugin },
    { name: '@moxxy/plugin-memory', plugin: memoryPlugin },
    {
      name: '@moxxy/memory-consolidate',
      plugin: buildMemoryConsolidatePlugin(memory, () => session.providers.getActive()),
    },
    { name: '@moxxy/plugin-cli', plugin: cliPlugin },
    { name: '@moxxy/plugin-channel-http', plugin: httpChannelPlugin },
    { name: '@moxxy/plugin-telegram', plugin: buildTelegramPlugin({ vault }) },
    { name: '@moxxy/plugin-browser', plugin: browserPlugin },
    // macOS-only computer control: screenshot, click, type, key,
    // open, clipboard, applescript. Plugin always registers (so the
    // model's tool list is stable across hosts); handlers throw a
    // clear "macOS only" error on Linux/Windows.
    { name: '@moxxy/plugin-computer-control', plugin: computerControlPlugin },
    // Generic OAuth 2.0 + PKCE client. Adds oauth_authorize /
    // oauth_get_token / oauth_clear_token tools that any skill can
    // chain (Google OAuth → MCP env, GitHub OAuth → API calls, …).
    { name: '@moxxy/plugin-oauth', plugin: buildOauthPlugin({ vault }) },
    // Universal slash commands (/info, /clear, /new, /exit, /help)
    // shared across every channel via session.commands. Disable to
    // hide them everywhere — channel-local commands keep working.
    { name: '@moxxy/plugin-commands', plugin: commandsPlugin },
    // Subagents are a swappable block: this plugin owns the
    // dispatch_agent tool and the auto-detection skill. Drop it
    // (`config.plugins['@moxxy/plugin-subagents'].enabled = false`) and
    // the model can't spawn children — the normal single-loop flow runs.
    // Agent kinds (researcher, code-reviewer, ...) come from OTHER plugins
    // via `PluginSpec.agents`; the closure here reads the live registry.
    {
      name: '@moxxy/plugin-subagents',
      plugin: buildSubagentsPlugin({
        getAgent: (name) => session.agents.get(name),
      }),
    },
    // Runtime plugin installer — exposes `install_plugin` to the model.
    // Hot-reloads via session.pluginHost.reload() so newly-npm-installed
    // packages drop into the active registries without restart. Drop this
    // plugin to lock the plugin set (e.g. for production deployments).
    {
      name: '@moxxy/plugin-plugins-admin',
      plugin: buildPluginsAdminPlugin({
        reload: () => session.pluginHost.reload(),
        snapshot: () => ({
          tools: session.tools.list().map((t) => t.name),
          agents: session.agents.list().map((a) => a.name),
          providers: session.providers.list().map((p) => p.name),
          loops: session.loops.list().map((l) => l.name),
          compactors: session.compactors.list().map((c) => c.name),
          channels: session.channels.list().map((c) => c.name),
        }),
      }),
    },
    // Admin tools (mcp_add_server, mcp_list_servers, mcp_remove_server,
    // mcp_test_server) plus the boot-time lazy attach. Passing the
    // session's live tool registry enables both hot-attach for runtime
    // adds AND lazy stub registration in onInit for saved servers.
    (() => {
      const { plugin, api } = buildMcpAdminPluginWithApi({
        toolRegistry: session.tools,
        skillRegistry: session.skills,
        userSkillsDir: rawConfig.skills?.userDir,
      });
      // Stash the api on the session so the TUI / CLI can call
      // enableAndAttach + detach without going through the model. Loose
      // typing — `mcpAdmin` isn't part of Session's declared shape.
      (session as unknown as { mcpAdmin: McpAdminApi }).mcpAdmin = api;
      return { name: '@moxxy/plugin-mcp-admin', plugin };
    })(),
    {
      name: '@moxxy/synthesize-skill',
      // Thread the SAME directory set the boot scan uses so reload_skills
      // doesn't drop builtin/plugin skills when invoked at runtime.
      plugin: buildSynthesizeSkillPlugin(session, {
        builtinDir: BUILTIN_SKILLS_DIR,
        ...(rawConfig.skills?.extraDirs ? { pluginDirs: rawConfig.skills.extraDirs } : {}),
        ...(rawConfig.skills?.projectDir ? { projectDir: rawConfig.skills.projectDir } : {}),
        ...(rawConfig.skills?.userDir ? { userDir: rawConfig.skills.userDir } : {}),
      }),
    },
  ];

  // Scheduler — fires recurring/one-shot prompts at user-defined times.
  // The runner reuses the active session for v1; scheduled prompts
  // appear in conversation history so the user sees what fired. An
  // isolated child-session runner is the obvious follow-up to avoid
  // context pollution.
  const { plugin: schedulerPlugin, store: scheduleStore, poller: schedulerPoller } =
    buildSchedulerPlugin({
      runner: schedulerRunner,
      skills: session.skills,
      logger,
    });
  entries.push({ name: '@moxxy/plugin-scheduler', plugin: schedulerPlugin });

  return {
    entries,
    scheduler: { store: scheduleStore, poller: schedulerPoller },
  };
}

// runTurn is re-exported so scheduler-runner.ts and any other consumer
// can share the same dependency surface as the builtins.
export { runTurn };
