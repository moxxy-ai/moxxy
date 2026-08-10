import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import type { ParsedArgv } from '../argv.js';
import { helpRequested, stringFlag } from '../argv-helpers.js';
import { printError } from '../errors.js';
import { colors } from '../colors.js';
import { formatHelp } from './help-format.js';
import { findProfile, PROFILES } from '../profiles.js';

const HELP = formatHelp({
  title: 'moxxy profile',
  tagline: 'print a deployment baseline for the system config scope',
  sections: [
    {
      title: 'COMMANDS',
      rows: [
        ['list', 'show the available profiles'],
        ['<name>', 'print the profile to stdout for review'],
        ['<name> --write <path>', 'write it to a file (refuses to overwrite)'],
      ],
    },
    {
      title: 'NOTES',
      rows: [
        [
          'system scope',
          'a profile belongs in /etc/moxxy/config.yaml (or %PROGRAMDATA%\\moxxy\\, or $MOXXY_SYSTEM_CONFIG), which usually needs root',
        ],
        ['review first', 'profiles carry commented, site-specific entries with no safe default'],
      ],
    },
    {
      title: 'EXAMPLES',
      rows: [
        ['moxxy profile enterprise', ''],
        ['moxxy profile enterprise | sudo tee /etc/moxxy/config.yaml', ''],
      ],
    },
  ],
});

export async function runProfileCommand(argv: ParsedArgv): Promise<number> {
  const sub = argv.positional[0];
  const wantsHelp = sub === 'help' || helpRequested(argv);
  if (!sub || wantsHelp) {
    process.stdout.write(HELP);
    return wantsHelp ? 0 : 2;
  }

  if (sub === 'list') {
    const col = Math.max(...PROFILES.map((p) => p.name.length));
    for (const p of PROFILES) {
      process.stdout.write(`${colors.bold(p.name.padEnd(col))}  ${colors.dim(p.description)}\n`);
      process.stdout.write(`${' '.repeat(col)}  ${colors.dim(`goes in ${p.target}`)}\n`);
    }
    return 0;
  }

  const profile = findProfile(sub);
  if (!profile) {
    printError(`unknown profile: ${sub}\nrun \`moxxy profile list\` to see what exists`);
    return 2;
  }

  const target = stringFlag(argv, 'write');
  if (!target) {
    // Bare stdout, no decoration: the common use is piping into `sudo tee`.
    process.stdout.write(profile.yaml);
    return 0;
  }

  const resolved = path.resolve(target);
  try {
    // Never overwrite: a system config already in place encodes decisions
    // somebody made, and clobbering it could silently unlock a control.
    await fs.writeFile(resolved, profile.yaml, { flag: 'wx' });
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'EEXIST') {
      printError(
        `refusing to overwrite ${resolved}\n` +
          'It may already encode decisions someone made. Diff against ' +
          `\`moxxy profile ${profile.name}\` and merge by hand.`,
      );
      return 1;
    }
    printError(`cannot write ${resolved}: ${err instanceof Error ? err.message : String(err)}`);
    return 1;
  }
  process.stdout.write(
    `wrote ${resolved}\n` +
      colors.dim(`review it, fill in the commented entries, then verify with \`moxxy doctor\`\n`),
  );
  return 0;
}
