import { aggregateCapabilitySpecs, type CapabilitySpec } from '@moxxy/sdk';
import { describeCapabilitySurface, undeclaredToolsWarning } from '@moxxy/plugin-plugins-admin';
import type { ParsedArgv } from '../argv.js';
import { bootSessionWithConfig, hasBoolFlag, helpRequested, stringFlag } from '../argv-helpers.js';
import { printError } from '../errors.js';
import { colors } from '../colors.js';
import { formatHelp } from './help-format.js';
import type { AuditEntry } from '@moxxy/plugin-security';

const HELP = formatHelp({
  title: 'moxxy security',
  tagline: 'inspect plugin-security isolation state',
  sections: [
    {
      title: 'COMMANDS',
      rows: [
        ['audit', 'list every tool, its declared capabilities, and the resolved isolator'],
        ['audit --package <name>', "one package's tools + their COMBINED capability surface"],
        ['audit --by-package', 'declared/total rollup per contributing plugin'],
        ['isolators', 'list available Isolator impls'],
        ['status', 'show enabled state, default isolator, and declaration/ratchet modes'],
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
    const isolator = config.plugins?.isolator?.default ?? '(default: inproc)';
    // 'warn' is the plugin-side default while security is enabled (grace
    // mode); surface it as such rather than pretending the ratchet is off.
    const ratchet = config.security?.thirdPartyRequireDeclaration ?? 'warn';
    const ratchetNote =
      ratchet === 'enforce'
        ? colors.bold('enforce — undeclared third-party tools are denied')
        : ratchet === 'off'
          ? colors.dim('off')
          : colors.dim(
              `warn${config.security?.thirdPartyRequireDeclaration ? '' : ' (default)'} — undeclared third-party tools log a warning`,
            );
    process.stdout.write(
      `${colors.bold('enabled')}   ${enabled ? colors.bold('yes') : colors.dim('no')}\n` +
        `${colors.bold('isolator')}  ${colors.dim(isolator)}\n` +
        `${colors.bold('require')}   ${
          config.security?.requireDeclaration
            ? colors.bold('declaration required')
            : colors.dim('not enforced')
        }\n` +
        `${colors.bold('3rd-party')} ${ratchetNote}\n`,
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

    const packageFilter = stringFlag(argv, 'package');
    if (packageFilter) return renderPackageAudit(entries, packageFilter);
    if (hasBoolFlag(argv, 'by-package')) return renderByPackage(entries);

    const declared = entries.filter((e) => e.declared);
    const undeclared = entries.filter((e) => !e.declared);

    process.stdout.write(
      `${colors.bold(String(entries.length))} tools · ` +
        `${colors.bold(String(declared.length))} declared isolation · ` +
        `${colors.dim(String(undeclared.length) + ' undeclared')}\n\n`,
    );

    if (declared.length > 0) {
      const workerCount = declared.filter((e) => e.hasModuleRef).length;
      process.stdout.write(
        colors.bold('DECLARED') +
          colors.dim(`  · ${workerCount}/${declared.length} worker-capable (handlerModule set)`) +
          '\n',
      );
      const nameCol = Math.max(8, ...declared.map((e) => e.tool.length));
      for (const e of declared) {
        const caps = formatCapabilities(e.capabilities);
        const required = e.required ? colors.dim(`  req:${e.required}`) : '';
        // ◊ marks tools that ship a handlerModule and can run under
        // worker/subprocess isolators. Plain tools work under inproc/none only.
        const mark = e.hasModuleRef ? colors.bold('◊ ') : '  ';
        process.stdout.write(
          `  ${mark}${colors.bold(e.tool.padEnd(nameCol))}  ` +
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

/**
 * One package's audit view: its tools (declared + undeclared) and the
 * widest-wins UNION of everything its declared tools may touch — the
 * package's blast radius, for install-consent decisions and reviews.
 */
function renderPackageAudit(entries: ReadonlyArray<AuditEntry>, pkg: string): number {
  const mine = entries.filter((e) => e.plugin === pkg);
  if (mine.length === 0) {
    const known = [...new Set(entries.map((e) => e.plugin).filter(Boolean))].sort();
    process.stderr.write(
      colors.red(`no tools attributed to package: ${pkg}`) +
        '\n' +
        colors.dim(
          known.length
            ? `  known packages:\n${known.map((p) => `    ${p}`).join('\n')}\n`
            : '  (no plugin attribution available on this session)\n',
        ),
    );
    return 2;
  }

  const declared = mine.filter((e) => e.declared);
  const undeclared = mine.filter((e) => !e.declared);
  process.stdout.write(
    `${colors.bold(pkg)} · ${mine.length} tools · ` +
      `${colors.bold(String(declared.length))} declared · ` +
      `${
        undeclared.length
          ? colors.yellow(`${undeclared.length} undeclared`)
          : colors.dim('0 undeclared')
      }\n\n`,
  );

  const nameCol = Math.max(8, ...mine.map((e) => e.tool.length));
  for (const e of mine) {
    const mark = e.declared ? (e.hasModuleRef ? colors.bold('◊ ') : '  ') : colors.yellow('! ');
    const caps = e.declared ? formatCapabilities(e.capabilities) : colors.yellow('undeclared');
    process.stdout.write(
      `  ${mark}${colors.bold(e.tool.padEnd(nameCol))}  ${colors.dim('→ ' + e.resolvedIsolator)}  ${caps}\n`,
    );
  }

  if (declared.length > 0) {
    const surface = aggregateCapabilitySpecs(
      declared.map((e) => e.capabilities as CapabilitySpec | undefined),
    );
    process.stdout.write('\n' + colors.bold('COMBINED CAPABILITY SURFACE') + '\n');
    const rows = describeCapabilitySurface(surface);
    const labelCol = Math.max(9, ...rows.map((r) => r.label.length));
    for (const { label, value } of rows) {
      process.stdout.write(`  ${colors.bold(label.padEnd(labelCol))}  ${colors.dim(value)}\n`);
    }
    if (undeclared.length > 0) {
      process.stdout.write(
        colors.yellow(`  ⚠ ${undeclaredToolsWarning(undeclared.length, mine.length)}\n`),
      );
    }
  }
  return 0;
}

/** Rollup: declared/total per contributing plugin, gaps first. */
function renderByPackage(entries: ReadonlyArray<AuditEntry>): number {
  const groups = new Map<string, { declared: number; total: number }>();
  for (const e of entries) {
    const key = e.plugin ?? '(unattributed)';
    const g = groups.get(key) ?? { declared: 0, total: 0 };
    g.total += 1;
    if (e.declared) g.declared += 1;
    groups.set(key, g);
  }
  const rows = [...groups.entries()].sort(
    (a, b) => b[1].total - b[1].declared - (a[1].total - a[1].declared) || a[0].localeCompare(b[0]),
  );
  const nameCol = Math.max(8, ...rows.map(([n]) => n.length));
  for (const [name, g] of rows) {
    const complete = g.declared === g.total;
    const count = `${g.declared}/${g.total}`;
    process.stdout.write(
      `  ${colors.bold(name.padEnd(nameCol))}  ${
        complete ? colors.dim(count + ' ✓') : colors.yellow(count)
      }\n`,
    );
  }
  return 0;
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
