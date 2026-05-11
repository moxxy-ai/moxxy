import * as path from 'node:path';
import * as os from 'node:os';
import {
  Session,
  buildSynthesizeSkillPlugin,
  createAllowListResolver,
  createCallbackResolver,
  createLogger,
  defaultProjectSkillsDir,
  defaultUserSkillsDir,
  denyByDefaultResolver,
  discoverSkills,
  PermissionEngine,
  silentLogger,
} from '@moxxy/core';
import type { PermissionResolver } from '@moxxy/sdk';
import { anthropicPlugin } from '@moxxy/plugin-provider-anthropic';
import { builtinToolsPlugin } from '@moxxy/tools-builtin';
import { toolUseLoopPlugin } from '@moxxy/loop-tool-use';
import { summarizeCompactorPlugin } from '@moxxy/compactor-summarize';
import { BUILTIN_SKILLS_DIR } from '@moxxy/skills-builtin';

export interface SetupOptions {
  readonly cwd: string;
  readonly verbose?: boolean;
  readonly providerConfig?: Record<string, unknown>;
  readonly resolver?: PermissionResolver;
  readonly model?: string;
}

export async function setupSession(opts: SetupOptions): Promise<Session> {
  const logger = opts.verbose ? createLogger({ minLevel: 'debug' }) : silentLogger;
  const userPolicyPath = path.join(os.homedir(), '.moxxy', 'permissions.json');
  const permissionEngine = await PermissionEngine.load(userPolicyPath);

  const session = new Session({
    cwd: opts.cwd,
    logger,
    permissionEngine,
    permissionResolver: opts.resolver ?? denyByDefaultResolver,
  });

  // Wire built-in plugins
  session.pluginHost.registerStatic(anthropicPlugin);
  session.providers.setActive('anthropic', opts.providerConfig ?? {});
  session.pluginHost.registerStatic(builtinToolsPlugin);
  session.pluginHost.registerStatic(toolUseLoopPlugin);
  session.pluginHost.registerStatic(summarizeCompactorPlugin);
  session.pluginHost.registerStatic(buildSynthesizeSkillPlugin(session));

  // Load skills
  const skills = await discoverSkills({
    projectDir: defaultProjectSkillsDir(opts.cwd),
    userDir: defaultUserSkillsDir(),
    builtinDir: BUILTIN_SKILLS_DIR,
    logger,
  });
  for (const skill of skills) session.skills.register(skill);

  return session;
}

export { createAllowListResolver, createCallbackResolver, denyByDefaultResolver };
