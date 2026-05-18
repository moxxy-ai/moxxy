import {
  createInteractivePermissionResolver,
  InteractiveSession,
  loadPreferences,
  type InteractiveBootStep,
} from '@moxxy/plugin-cli';
import { render } from 'ink';
import React from 'react';
import type {
  PendingToolCall,
  PermissionContext,
  PermissionDecision,
} from '@moxxy/sdk';
import { loadConfig } from '@moxxy/config';
import { setupSession, setupSessionWithConfig, type BootStep } from '../setup.js';
import { argvToSetupOptions, stringFlag } from '../argv-helpers.js';
import type { ParsedArgv } from '../argv.js';
import { cliVersion } from '../version.js';
import { runInitCommand } from './init.js';

/**
 * Bootstrap-inverted TUI entry point. Renders Ink immediately so the
 * boot screen (centered logo + tips + progress checklist) shows from
 * the first frame, and runs `setupSessionWithConfig` lazily inside the
 * InteractiveSession's mount effect. Boot progress flows back via a
 * callback so the checklist ticks live as each step completes.
 *
 * First-run setup (no config, or no provider activates) still runs the
 * `moxxy init` wizard BEFORE Ink mounts — the wizard owns stdin in
 * canonical mode, and competing with Ink's raw-mode reader would
 * deadlock.
 */
export async function runTuiWithBootstrap(argv: ParsedArgv): Promise<number> {
  if (process.stdin.isTTY) {
    const { sources } = await loadConfig({
      cwd: process.cwd(),
      ...(stringFlag(argv, 'config') ? { explicitPath: stringFlag(argv, 'config')! } : {}),
    });
    let needsInit = sources.length === 0;
    if (!needsInit) {
      try {
        const probe = await setupSession({
          ...argvToSetupOptions(argv),
          tolerateNoProvider: true,
          skipKeyPrompt: true,
        });
        if (!probe.providers.getActiveName()) needsInit = true;
      } catch {
        needsInit = true;
      }
    }
    if (needsInit) {
      const code = await runInitCommand(argv);
      if (code !== 0) return code;
    }
  }

  let promptHandler:
    | ((call: PendingToolCall, ctx: PermissionContext) => Promise<PermissionDecision>)
    | null = null;
  const resolver = createInteractivePermissionResolver({
    name: 'tui',
    prompt: async (call, ctx) => {
      if (!promptHandler) return { mode: 'deny', reason: 'TUI not ready' };
      return promptHandler(call, ctx);
    },
  });

  const cliModel = stringFlag(argv, 'model');
  const prefs = await loadPreferences();
  const effectiveModel = cliModel ?? prefs.model;
  const version = cliVersion();

  const { waitUntilExit } = render(
    React.createElement(InteractiveSession, {
      bootstrap: async (progress: (step: InteractiveBootStep) => void) => {
        const result = await setupSessionWithConfig({
          ...argvToSetupOptions(argv),
          resolver,
          onProgress: (step: BootStep) => progress(toInteractiveStep(step)),
        });
        return result.session;
      },
      registerInteractiveResolver: (handler) => {
        promptHandler = handler;
      },
      ...(effectiveModel ? { model: effectiveModel } : {}),
      ...(version ? { version } : {}),
    }),
  );

  await waitUntilExit();
  return 0;
}

function toInteractiveStep(step: BootStep): InteractiveBootStep {
  switch (step.kind) {
    case 'provider-activated':
      return { kind: 'provider-activated', detail: step.name };
    case 'provider-failed':
      return { kind: 'provider-failed', error: step.error };
    case 'plugins-registered':
      return { kind: 'plugins-registered', detail: `${step.count}` };
    case 'skills-loaded':
      return { kind: 'skills-loaded', detail: `${step.count}` };
    case 'config-loaded':
      return { kind: 'config-loaded' };
    case 'prefs-applied':
      return { kind: 'prefs-applied' };
    case 'init-hooks-done':
      return { kind: 'init-hooks-done' };
    case 'ready':
      return { kind: 'ready' };
  }
}
