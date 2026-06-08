/**
 * `moxxy update` — check npm for a newer `@moxxy/cli` and upgrade in place.
 *
 * Detects how moxxy was installed (npm / pnpm / yarn / bun, global or local)
 * and runs the matching upgrade command after confirming. Flags:
 *   --check / --dry-run   report current → latest + the command, don't run it
 *   --yes, -y             skip the confirmation prompt
 * In a non-interactive shell with no `--yes`, it prints the command instead of
 * running it (so a script never triggers an unattended global install).
 *
 * The version check is fail-soft: offline / registry errors degrade to a hint,
 * never an error.
 */

import { spawn } from 'node:child_process';
import { confirm, isCancel } from '@clack/prompts';

import type { ParsedArgv } from '../argv.js';
import { confirmedYes, hasBoolFlag, helpRequested } from '../argv-helpers.js';
import { printError } from '../errors.js';
import { colors } from '../colors.js';
import { cliVersion } from '../version.js';
import { formatHelp } from './help-format.js';
import { checkForCliUpdate, type CliUpdateCheck } from '../update/check.js';
import { detectInstall, formatCmd, type InstallInfo } from '../update/detect-install.js';

const HELP = formatHelp({
  title: 'moxxy update',
  tagline: 'update the moxxy CLI to the latest published version',
  sections: [
    {
      title: 'USAGE',
      rows: [
        ['moxxy update', 'check npm + upgrade (asks before running)'],
        ['moxxy update --check', 'report current vs latest, print the command, do nothing'],
        ['moxxy update --yes', 'upgrade without the confirmation prompt'],
      ],
    },
    {
      title: 'NOTES',
      notes: [
        'Detects npm / pnpm / yarn / bun (global or local) and runs the matching upgrade.',
        'From a source checkout, update with git instead — nothing is installed.',
      ],
    },
  ],
});

/** Run a command, inheriting stdio so the user watches npm/pnpm output live. */
async function runCommand(cmd: ReadonlyArray<string>): Promise<number> {
  const [bin, ...args] = cmd;
  if (!bin) return 1;
  return new Promise<number>((resolve) => {
    const proc = spawn(bin, args, {
      stdio: 'inherit',
      // npm/pnpm/yarn/bun are `.cmd` shims on Windows — needs a shell to launch.
      shell: process.platform === 'win32',
    });
    proc.on('error', () => resolve(127));
    proc.on('exit', (code) => resolve(code ?? 1));
  });
}

/** Injectable seams so the command is testable without network / spawning. */
export interface UpdateDeps {
  current?: string | undefined;
  check?: (current: string | undefined) => Promise<CliUpdateCheck | null>;
  detect?: () => InstallInfo;
  run?: (cmd: ReadonlyArray<string>) => Promise<number>;
  /** Override TTY detection (defaults to stdin.isTTY). */
  interactive?: boolean;
  /** Override the confirm prompt (defaults to a clack confirm). */
  promptConfirm?: (message: string) => Promise<boolean>;
  out?: (s: string) => void;
}

export async function runUpdateCommand(argv: ParsedArgv, deps: UpdateDeps = {}): Promise<number> {
  if (helpRequested(argv) || argv.positional[0] === 'help') {
    process.stdout.write(HELP);
    return 0;
  }

  const out = deps.out ?? ((s: string) => process.stdout.write(s));
  const current = deps.current ?? cliVersion();
  const checkOnly = hasBoolFlag(argv, 'check') || hasBoolFlag(argv, 'dry-run');
  const check = deps.check ?? ((c) => checkForCliUpdate(c, { force: true }));
  const detect = deps.detect ?? (() => detectInstall());
  const run = deps.run ?? runCommand;

  out(colors.dim('Checking for updates…\n'));
  const result = await check(current);

  if (!result) {
    // Offline / registry error — degrade to a manual hint, not a failure.
    const info = detect();
    out(colors.dim(`Could not reach the npm registry. Current version: ${current ?? 'unknown'}.\n`));
    if (info.manager !== 'workspace') {
      out(colors.dim('To update manually:\n  ') + colors.bold(formatCmd(info.cmd)) + '\n');
    }
    return 0;
  }

  if (!result.updateAvailable) {
    out(colors.green('✓ ') + `You're on the latest moxxy (v${result.current}).\n`);
    return 0;
  }

  out(
    `Update available: ${colors.dim('v' + result.current)} → ${colors.bold(colors.green('v' + result.latest))}\n`,
  );

  const info = detect();
  if (info.manager === 'workspace') {
    out(
      colors.dim(
        'You\'re running moxxy from a source checkout — nothing to install.\n' +
          'Update with: ',
      ) + colors.bold('git pull') + colors.dim(' && pnpm install && pnpm build') + '\n',
    );
    return 0;
  }

  const cmdStr = formatCmd(info.cmd);
  out(colors.dim('Will run: ') + colors.bold(cmdStr) + '\n');

  if (checkOnly) return 0;

  // Decide whether to actually run the upgrade.
  const interactive = deps.interactive ?? Boolean(process.stdin.isTTY);
  let proceed = confirmedYes(argv);
  if (!proceed) {
    if (!interactive) {
      out(colors.dim('Re-run with --yes to apply, or run the command above yourself.\n'));
      return 0;
    }
    const ask = deps.promptConfirm ?? defaultConfirm;
    proceed = await ask(`Run \`${cmdStr}\` now?`);
    if (!proceed) {
      out(colors.dim('Skipped. Run the command above when you\'re ready.\n'));
      return 0;
    }
  }

  out(colors.dim(`\n$ ${cmdStr}\n`));
  const code = await run(info.cmd);
  if (code === 0) {
    out('\n' + colors.green('✓ ') + `Updated to v${result.latest}. Restart moxxy to use it.\n`);
    return 0;
  }
  printError(`update command exited with code ${code}`);
  return code || 1;
}

async function defaultConfirm(message: string): Promise<boolean> {
  const answer = await confirm({ message });
  if (isCancel(answer)) return false;
  return answer === true;
}
