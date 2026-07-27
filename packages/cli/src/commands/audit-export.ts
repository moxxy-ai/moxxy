import * as os from 'node:os';
import { exportAuditTrail, otlpAuditExporter, pendingExportCount, readCheckpoint } from '@moxxy/core';
import type { AuditExporterDef } from '@moxxy/sdk';
import { resolveOsPrincipal } from '@moxxy/sdk/server';
import { loadConfig } from '@moxxy/config';
import type { ParsedArgv } from '../argv.js';
import { argvToSetupOptions, helpRequested } from '../argv-helpers.js';
import { probeSession } from '../setup.js';
import { printError } from '../errors.js';
import { colors } from '../colors.js';
import { cliVersion } from '../version.js';
import { formatHelp } from './help-format.js';

const HELP = formatHelp({
  title: 'moxxy audit export',
  tagline: 'ship the local audit trail to a central collector',
  sections: [
    {
      title: 'COMMANDS',
      rows: [
        ['audit export', 'send everything recorded since the last checkpoint'],
        ['audit export --dry-run', 'report what would be sent, send nothing'],
        ['audit export --json', 'machine-readable result, for a scheduled job'],
      ],
    },
    {
      title: 'NOTES',
      rows: [
        [
          'additive',
          'the local hash-chained file stays the system of record and is what this reads from. A collector being down delays central visibility; it never loses a record.',
        ],
        [
          'at least once',
          'the checkpoint advances only after the collector durably accepts a batch, so a crash re-sends rather than skips. Each record carries its chain hash for the collector to deduplicate on.',
        ],
      ],
    },
  ],
});

export async function runAuditExportCommand(argv: ParsedArgv): Promise<number> {
  if (helpRequested(argv)) {
    process.stdout.write(HELP);
    return 0;
  }
  const asJson = argv.flags.json === true;

  // Deliberately session-free on the common path. Exporting reads files that
  // are already written, so requiring a working model provider would make a
  // compliance job fail on a machine whose API key expired, and booting a
  // session would append a fresh record to the very trail being exported. A
  // session is paid for only when a plugin-provided exporter has to be
  // resolved by name.
  const { config } = await loadConfig({ cwd: process.cwd() });
  const settings = config.audit?.export;
  if (!settings) {
    printError(
      'no export configured. Set `audit.export.endpoint` (and `audit.enabled: true`) first.',
    );
    return 1;
  }
  if (!config.audit?.enabled) {
    printError('audit.enabled is false, so there is no trail to export.');
    return 1;
  }

  const name = settings.exporter;
  const exporter: AuditExporterDef | undefined =
    name === otlpAuditExporter.name ? otlpAuditExporter : await resolvePluginExporter(argv, name);
  if (!exporter) {
    printError(`audit exporter '${name}' is not registered.`);
    return 1;
  }

  const pending = await pendingExportCount(exporter.name, settings.endpoint);
  if (argv.flags['dry-run'] === true) {
    const cp = await readCheckpoint(exporter.name, settings.endpoint);
    const out = { exporter: exporter.name, endpoint: settings.endpoint, pending, checkpoint: cp };
    process.stdout.write(
      asJson
        ? JSON.stringify(out, null, 2) + '\n'
        : `  ${colors.bold('pending')}  ${pending} record(s)\n` +
            `  ${colors.bold('from')}     ${cp ? `${cp.day} seq ${cp.seq}` : 'the beginning'}\n` +
            `  ${colors.bold('to')}       ${exporter.name} ${settings.endpoint}\n`,
    );
    return 0;
  }

  const result = await exportAuditTrail(exporter, {
    endpoint: settings.endpoint,
    ...(settings.batchSize ? { batchSize: settings.batchSize } : {}),
    settings: { ...(settings.headers ? { headers: settings.headers } : {}) },
    resource: {
      host: os.hostname(),
      cliVersion: cliVersion() ?? 'unknown',
      principal: resolveOsPrincipal(),
    },
  });

  if (asJson) {
    process.stdout.write(JSON.stringify({ pending, ...result }, null, 2) + '\n');
  } else {
    process.stdout.write(
      `  ${colors.bold('sent')}  ${result.sent} record(s) in ${result.batches} batch(es)\n`,
    );
    if (result.stoppedBecause) {
      process.stdout.write(
        colors.yellow(`  stopped: ${result.stoppedBecause}\n`) +
          colors.dim('  the checkpoint did not advance past this batch; rerun to retry\n'),
      );
    }
  }

  // Non-zero when the run did not drain, so a scheduled job surfaces a
  // collector that has been unreachable rather than logging "sent 0".
  return result.stoppedBecause ? 1 : 0;
}

/** Boot a session only to resolve a plugin-contributed exporter by name. */
async function resolvePluginExporter(
  argv: ParsedArgv,
  name: string,
): Promise<AuditExporterDef | undefined> {
  return probeSession(
    { ...argvToSetupOptions(argv), skipKeyPrompt: true, tolerateNoProvider: true },
    async ({ session }) => session.auditExporters.list().find((e) => e.name === name),
  );
}
