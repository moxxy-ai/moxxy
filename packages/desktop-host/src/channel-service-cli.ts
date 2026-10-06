/**
 * The OS background-service port backed by `moxxy service` (launchd on macOS,
 * systemd --user on Linux) — the CLI owns unit rendering + install, so the
 * desktop never duplicates that logic. Each call runs the CLI to completion.
 */

import type { ChannelServicePort } from './channel-run-mode';
import { augmentedPaths, resolveMoxxyCli, spawnCli } from './cli-resolver';

function runService(args: ReadonlyArray<string>): Promise<string> {
  const cli = resolveMoxxyCli({ extraPaths: augmentedPaths() });
  if (!cli) return Promise.reject(new Error('moxxy CLI not found'));
  const child = spawnCli(cli, ['service', ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '';
  let stderr = '';
  child.stdout?.on('data', (chunk: Buffer) => (stdout += chunk.toString()));
  child.stderr?.on('data', (chunk: Buffer) => (stderr += chunk.toString()));
  return new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (code) => {
      if (code === 0) resolve(stdout);
      else reject(new Error(stderr.trim() || `moxxy service ${args.join(' ')} exited with ${code}`));
    });
  });
}

export function createCliServicePort(): ChannelServicePort {
  return {
    async status(id) {
      const parsed = JSON.parse(await runService(['status', id, '--json'])) as {
        installed?: unknown;
        running?: unknown;
      };
      return { installed: parsed.installed === true, running: parsed.running === true };
    },
    async install(id) {
      await runService(['install', id]);
    },
    async uninstall(id) {
      await runService(['uninstall', id]);
    },
  };
}
