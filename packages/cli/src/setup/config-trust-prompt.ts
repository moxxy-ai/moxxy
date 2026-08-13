import * as readline from 'node:readline/promises';
import type { ConfigTrustPrompt } from '@moxxy/config';
import { colors } from '../colors.js';

/**
 * Interactive consent for executing an untrusted project config.
 *
 * `moxxy.config.{ts,js}` is code, executed with the user's full privileges
 * before the permission engine, the vault, or any isolator exists, and the
 * project search walks upward, so `git clone` + `cd` + `moxxy` used to run a
 * stranger's code silently. This is the moment that stops.
 *
 * Returns null when there is nobody to ask (no TTY): the loader then refuses to
 * execute the file rather than falling back to running it, and the operator
 * pre-approves with `moxxy config trust`. Fail-closed is the only defensible
 * default for arbitrary code execution.
 */
export function interactiveConfigTrustPrompt(): ConfigTrustPrompt | undefined {
  if (!process.stdin.isTTY || !process.stderr.isTTY) return undefined;
  return async ({ path, sha256 }) => {
    // Prompt on stderr so a piped `moxxy -p "…" > out.txt` keeps stdout clean.
    process.stderr.write(
      '\n' +
        colors.bold('This project wants to run code before moxxy starts.') +
        '\n' +
        `  ${path}\n` +
        colors.dim(`  sha256 ${sha256.slice(0, 16)}…\n`) +
        colors.dim('  Review it before approving. Approval is remembered for this exact\n') +
        colors.dim('  content, so an edit will ask again.\n'),
    );
    const rl = readline.createInterface({ input: process.stdin, output: process.stderr });
    try {
      // `rl.question` never settles when stdin hits EOF mid-prompt, which would
      // wedge boot. Race the close event and treat EOF as a refusal.
      const answer = await Promise.race([
        rl.question(`${colors.bold('Run it?')} [y/N] `),
        new Promise<string>((resolve) => rl.once('close', () => resolve(''))),
      ]);
      return answer.trim().toLowerCase() === 'y';
    } finally {
      rl.close();
    }
  };
}
