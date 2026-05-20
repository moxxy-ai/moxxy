import type { ParsedArgv } from '../argv.js';
import { bootSessionWithConfig, helpRequested } from '../argv-helpers.js';
import { printError } from '../errors.js';
import { colors } from '../colors.js';
import { formatHelp } from './help-format.js';

const HELP = formatHelp({
  title: 'moxxy security',
  tagline: 'inspect plugin-security isolation state',
  sections: [
    {
      title: 'COMMANDS',
      rows: [
        ['audit', 'list every tool, its declared capabilities, and the resolved isolator'],
        ['isolators', 'list available Isolator impls'],
        ['status', 'show whether security is enabled and the default isolator'],
      ],
    },
  ],
});

export async function runSecurityCommand(argv: ParsedArgv): Promise<number> {
  const sub = argv.positional[0] ?? 'audit';
  if (sub === 'help' || helpRequested(argv)) {
    process.stdout.write(HELP);
    return 0;
  }

  const { config, security } = await bootSessionWithConfig(argv, {
    skipKeyPrompt: true,
    tolerateNoProvider: true,
    skipProviderActivation: true,
  });

  if (sub === 'status') {
    const enabled = config.security?.enabled ?? false;
    const isolator = config.security?.isolator ?? '(default: inproc)';
    process.stdout.write(
      `${colors.bold('enabled')}   ${enabled ? colors.bold('yes') : colors.dim('no')}\n` +
        `${colors.bold('isolator')}  ${colors.dim(isolator)}\n` +
        `${colors.bold('require')}   ${
          config.security?.requireDeclaration
            ? colors.bold('declaration required')
            : colors.dim('not enforced')
        }\n`,
    );
    return 0;
  }

  if (sub === 'isolators') {
    const list = security.registry.list();
    const nameCol = Math.max(8, ...list.map((i) => i.name.length));
    for (const iso of list) {
      process.stdout.write(
        `${colors.bold(iso.name.padEnd(nameCol))}  ${colors.dim(`strength: ${iso.strength}`)}\n`,
      );
    }
    return 0;
  }

  if (sub === 'audit') {
    const entries = security.audit();
    if (entries.length === 0) {
      process.stdout.write(colors.dim('(no tools registered)') + '\n');
      return 0;
    }

    const declared = entries.filter((e) => e.declared);
    const undeclared = entries.filter((e) => !e.declared);

    process.stdout.write(
      `${colors.bold(String(entries.length))} tools · ` +
        `${colors.bold(String(declared.length))} declared isolation · ` +
        `${colors.dim(String(undeclared.length) + ' undeclared')}\n\n`,
    );

    if (declared.length > 0) {
      process.stdout.write(colors.bold('DECLARED') + '\n');
      const nameCol = Math.max(8, ...declared.map((e) => e.tool.length));
      for (const e of declared) {
        const caps = formatCapabilities(e.capabilities);
        const required = e.required ? colors.dim(`  req:${e.required}`) : '';
        process.stdout.write(
          `  ${colors.bold(e.tool.padEnd(nameCol))}  ` +
            `${colors.dim('→ ' + e.resolvedIsolator)}${required}  ${caps}\n`,
        );
      }
      process.stdout.write('\n');
    }

    if (undeclared.length > 0) {
      process.stdout.write(
        colors.bold('UNDECLARED') +
          colors.dim(' (run as-is; no isolation enforced even when security is enabled)') +
          '\n',
      );
      const nameCol = Math.max(8, ...undeclared.map((e) => e.tool.length));
      const limit = 30;
      for (const e of undeclared.slice(0, limit)) {
        process.stdout.write(
          `  ${colors.dim(e.tool.padEnd(nameCol))}  ${colors.dim('→ ' + e.resolvedIsolator)}\n`,
        );
      }
      if (undeclared.length > limit) {
        process.stdout.write(colors.dim(`  … and ${undeclared.length - limit} more\n`));
      }
    }
    return 0;
  }

  printError(`unknown 'security' subcommand: ${sub}\n${HELP}`);
  return 2;
}

function formatCapabilities(caps: Readonly<Record<string, unknown>> | undefined): string {
  if (!caps) return '';
  const bits: string[] = [];
  const fs = caps.fs as { read?: ReadonlyArray<string>; write?: ReadonlyArray<string> } | undefined;
  if (fs?.read?.length) bits.push(`fs:read(${fs.read.length})`);
  if (fs?.write?.length) bits.push(`fs:write(${fs.write.length})`);
  const net = caps.net as { mode?: string } | undefined;
  if (net?.mode) bits.push(`net:${net.mode}`);
  const env = caps.env as ReadonlyArray<string> | undefined;
  if (env?.length) bits.push(`env(${env.length})`);
  if (typeof caps.timeMs === 'number') bits.push(`time:${caps.timeMs}ms`);
  return colors.dim(bits.join(' '));
}
