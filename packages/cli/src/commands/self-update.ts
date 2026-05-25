import * as os from 'node:os';
import * as path from 'node:path';
import {
  detectCoreInstall,
  listCoreTxns,
  listTransactions,
  readCoreJournal,
  restoreOverlay,
} from '@moxxy/plugin-self-update';
import type { ParsedArgv } from '../argv.js';
import { helpRequested } from '../argv-helpers.js';
import { printError } from '../errors.js';
import { colors } from '../colors.js';
import { formatHelp } from './help-format.js';

const HELP = formatHelp({
  title: 'moxxy self-update',
  tagline: 'inspect and roll back self-update transactions',
  sections: [
    {
      title: 'COMMANDS',
      rows: [
        ['status', 'list Tier-1 (plugin/skill) and Tier-2 (core) transactions'],
        ['rollback <coreTxnId>', 'restore a core overlay from its snapshot (then restart moxxy)'],
      ],
    },
  ],
});

function moxxyDir(): string {
  return path.join(os.homedir(), '.moxxy');
}

export async function runSelfUpdateCommand(argv: ParsedArgv): Promise<number> {
  const sub = argv.positional[0] ?? 'status';
  if (sub === 'help' || helpRequested(argv)) {
    process.stdout.write(HELP);
    return 0;
  }

  if (sub === 'status') {
    const dir = moxxyDir();
    const txns = await listTransactions(dir);
    const core = await listCoreTxns(dir);
    process.stdout.write(colors.bold('Tier 1 — plugins / skills\n'));
    if (txns.length === 0) process.stdout.write(colors.dim('  (none)\n'));
    for (const t of txns) {
      process.stdout.write(`  ${colors.bold(t.txnId)}  ${t.state}  ${colors.dim(`${t.target.kind}:${t.target.name}`)}\n`);
    }
    process.stdout.write(colors.bold('\nTier 2 — core\n'));
    if (core.length === 0) process.stdout.write(colors.dim('  (none)\n'));
    for (const c of core) {
      process.stdout.write(`  ${colors.bold(c.txnId)}  ${c.state}  ${colors.dim(c.packages.join(', '))}\n`);
    }
    return 0;
  }

  if (sub === 'rollback') {
    const txnId = argv.positional[1];
    if (!txnId) {
      printError('usage: moxxy self-update rollback <coreTxnId>');
      return 2;
    }
    const dir = moxxyDir();
    const journal = await readCoreJournal(dir, txnId).catch(() => null);
    if (!journal) {
      printError(`no core transaction "${txnId}" (only Tier-2 core txns can be rolled back from the CLI)`);
      return 2;
    }
    const install = detectCoreInstall(import.meta.url);
    if (!install) {
      printError('could not resolve the installed @moxxy/core');
      return 1;
    }
    await restoreOverlay({
      install,
      pkgNames: journal.packages,
      snapshotDir: path.join(dir, 'self-update', 'core-txns', txnId, 'snapshot'),
    });
    process.stdout.write(
      colors.dim(`restored ${journal.packages.join(', ')} from snapshot — `) +
        colors.bold('restart moxxy to drop the patched code') +
        '\n',
    );
    return 0;
  }

  printError(`unknown 'self-update' subcommand: ${sub}\n${HELP}`);
  return 2;
}
