import * as path from 'node:path';
import * as os from 'node:os';
import { PermissionEngine } from '@moxxy/core';
import type { ParsedArgv } from '../argv.js';
import { confirmedYes, helpRequested } from '../argv-helpers.js';
import { printError } from '../errors.js';
import { colors } from '../colors.js';
import { formatHelp } from './help-format.js';

const HELP = formatHelp({
  title: 'moxxy perms',
  tagline: 'view and edit ~/.moxxy/permissions.json',
  sections: [
    {
      title: 'COMMANDS',
      rows: [
        ['list', 'show the current policy'],
        ['allow <tool> [reason]', 'add an allow rule (tool name; supports * glob)'],
        ['deny <tool> [reason]', 'add a deny rule'],
        ['remove <tool>', 'remove every rule (allow + deny) for <tool>'],
        ['clear', 'wipe the entire policy (requires --yes)'],
        ['path', 'print the path to the policy file'],
      ],
    },
  ],
});

function policyPath(): string {
  return path.join(os.homedir(), '.moxxy', 'permissions.json');
}

export async function runPermsCommand(argv: ParsedArgv): Promise<number> {
  if (helpRequested(argv)) {
    process.stdout.write(HELP);
    return 0;
  }

  // No subcommand + TTY → mount the Ink editor.
  const sub = argv.positional[0];
  if (!sub && process.stdin.isTTY) {
    const [{ render }, React, { PermissionEditor }] = await Promise.all([
      import('ink'),
      import('react'),
      import('@moxxy/plugin-cli'),
    ]);
    const { waitUntilExit } = render(
      React.createElement(PermissionEditor, { policyPath: policyPath() }),
    );
    await waitUntilExit();
    return 0;
  }

  const cmd = sub ?? 'list';
  const engine = await PermissionEngine.load(policyPath());

  switch (cmd) {
    case 'list': {
      const policy = engine.policySnapshot;
      if (policy.allow.length === 0 && policy.deny.length === 0) {
        process.stdout.write(colors.dim('(no rules configured)') + '\n');
        return 0;
      }
      const allNames = [...policy.deny, ...policy.allow].map((r) => r.name);
      const nameCol = Math.max(8, ...allNames.map((n) => n.length));
      if (policy.deny.length > 0) {
        process.stdout.write(colors.bold('DENY') + '\n');
        for (const r of policy.deny) {
          process.stdout.write(
            `  ${colors.bold(r.name.padEnd(nameCol))}  ${colors.dim(r.reason ?? '')}\n`,
          );
        }
        if (policy.allow.length > 0) process.stdout.write('\n');
      }
      if (policy.allow.length > 0) {
        process.stdout.write(colors.bold('ALLOW') + '\n');
        for (const r of policy.allow) {
          process.stdout.write(
            `  ${colors.bold(r.name.padEnd(nameCol))}  ${colors.dim(r.reason ?? '')}\n`,
          );
        }
      }
      return 0;
    }
    case 'allow':
    case 'deny': {
      const tool = argv.positional[1];
      if (!tool) {
        printError(`tool name required\n${HELP}`);
        return 2;
      }
      const reason = argv.positional.slice(2).join(' ') || undefined;
      if (cmd === 'allow') await engine.addAllow({ name: tool, ...(reason ? { reason } : {}) });
      else await engine.addDeny({ name: tool, ...(reason ? { reason } : {}) });
      process.stdout.write(
        `${colors.bold('added')}  ${colors.bold(cmd)} ${tool}` +
          (reason ? `  ${colors.dim('— ' + reason)}` : '') +
          '\n',
      );
      return 0;
    }
    case 'remove': {
      const tool = argv.positional[1];
      if (!tool) {
        printError(`tool name required\n${HELP}`);
        return 2;
      }
      const removed = await engine.removeByName(tool);
      process.stdout.write(
        removed === 0
          ? colors.dim(`no rules matched ${tool}`) + '\n'
          : `${colors.bold('removed')}  ${removed} rule${removed === 1 ? '' : 's'}\n`,
      );
      return 0;
    }
    case 'clear': {
      if (!confirmedYes(argv)) {
        printError('refusing to clear without --yes. Re-run as: moxxy perms clear --yes');
        return 2;
      }
      await engine.clear();
      process.stdout.write(colors.bold('cleared') + colors.dim('  permissions policy\n'));
      return 0;
    }
    case 'path': {
      process.stdout.write(policyPath() + '\n');
      return 0;
    }
    default:
      printError(`unknown 'perms' subcommand: ${cmd}\n${HELP}`);
      return 2;
  }
}
