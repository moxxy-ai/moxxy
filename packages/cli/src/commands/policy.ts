import {
  loadConfig,
  loadPolicyBundles,
  PolicyLoadError,
  type PolicyBundleRule,
} from '@moxxy/config';
import type { ParsedArgv } from '../argv.js';
import { helpRequested } from '../argv-helpers.js';
import { printError } from '../errors.js';
import { colors } from '../colors.js';
import { formatHelp } from './help-format.js';
import { policyFingerprint, policySummary } from '../setup/policy-fingerprint.js';

const HELP = formatHelp({
  title: 'moxxy policy',
  tagline: 'what the agent may do here, and who decided it',
  sections: [
    {
      title: 'COMMANDS',
      rows: [
        ['policy', 'the rules in force, each with its origin'],
        ['policy --check', 'verify every configured bundle, change nothing'],
        ['policy --json', 'machine-readable'],
      ],
    },
    {
      title: 'NOTES',
      rows: [
        [
          'origins',
          'a rule comes from your config or from a signed bundle. Both sit above ~/.moxxy/permissions.json and cannot be removed by an "allow always" answer.',
        ],
        [
          'fail closed',
          'a configured bundle that cannot be verified stops the session. Running without a policy you subscribe to is the condition this prevents.',
        ],
      ],
    },
  ],
});

interface RuleView {
  readonly effect: 'allow' | 'deny';
  readonly rule: PolicyBundleRule;
  readonly origin: string;
}

export async function runPolicyCommand(argv: ParsedArgv): Promise<number> {
  if (helpRequested(argv)) {
    process.stdout.write(HELP);
    return 0;
  }

  const { config } = await loadConfig({ cwd: process.cwd() });
  const refs = config.policy?.bundles ?? [];

  let loaded;
  try {
    loaded = await loadPolicyBundles(refs);
  } catch (err) {
    if (err instanceof PolicyLoadError) {
      printError(err.message);
      return 1;
    }
    throw err;
  }

  const rules: RuleView[] = [
    ...(config.permissions?.deny ?? []).map((rule) => ({
      effect: 'deny' as const,
      rule,
      origin: 'config',
    })),
    ...loaded.deny.map((rule) => ({ effect: 'deny' as const, rule, origin: 'bundle' })),
    ...(config.permissions?.allow ?? []).map((rule) => ({
      effect: 'allow' as const,
      rule,
      origin: 'config',
    })),
    ...loaded.allow.map((rule) => ({ effect: 'allow' as const, rule, origin: 'bundle' })),
  ];

  const summary = policySummary(config, loaded.sources);
  const stale = loaded.sources.filter((s) => s.from === 'cache');

  if (argv.flags.json === true) {
    process.stdout.write(
      JSON.stringify(
        { fingerprint: policyFingerprint(summary), summary, sources: loaded.sources, rules },
        null,
        2,
      ) + '\n',
    );
  } else {
    process.stdout.write(render(rules, loaded.sources, policyFingerprint(summary)));
  }

  // `--check` is for provisioning gates: a bundle serving off a stale cache
  // means this host is not actually current, which a green exit would hide.
  if (argv.flags.check === true && stale.length > 0) return 1;
  return 0;
}

function render(
  rules: ReadonlyArray<RuleView>,
  sources: ReadonlyArray<{
    id: string;
    revision: string;
    from: string;
    url: string;
    staleReason?: string;
  }>,
  fingerprint: string,
): string {
  const lines: string[] = [''];
  lines.push(`  ${colors.bold('fingerprint')}  ${fingerprint.slice(0, 16)}`);
  lines.push('');

  lines.push(`  ${colors.bold('bundles')}`);
  if (sources.length === 0) {
    lines.push(colors.dim('    none configured'));
  } else {
    for (const s of sources) {
      const mark = s.from === 'cache' ? colors.yellow(' (cached)') : '';
      lines.push(`    ${s.id}@${s.revision}${mark}`);
      lines.push(colors.dim(`      ${s.url}`));
      if (s.staleReason) lines.push(colors.yellow(`      remote unavailable: ${s.staleReason}`));
    }
  }
  lines.push('');

  lines.push(`  ${colors.bold('rules')}`);
  if (rules.length === 0) {
    lines.push(colors.dim('    none. Every tool call falls through to the permission engine.'));
  } else {
    for (const r of rules) {
      const effect = r.effect === 'deny' ? colors.red('deny ') : colors.green('allow');
      const match = describeMatch(r.rule);
      lines.push(
        `    ${effect}  ${r.rule.name}${match}  ${colors.dim(`[${r.origin}]`)}` +
          (r.rule.reason ? colors.dim(`  ${r.rule.reason}`) : ''),
      );
    }
  }
  lines.push('');
  return lines.join('\n');
}

function describeMatch(rule: PolicyBundleRule): string {
  const parts: string[] = [];
  for (const [field, value] of Object.entries(rule.inputPathPrefix ?? {})) {
    parts.push(`${field} under ${value}`);
  }
  for (const [field, value] of Object.entries(rule.inputGlob ?? {})) {
    parts.push(`${field} matches ${value}`);
  }
  // Flagged explicitly: an unanchored regex reads like a prefix and is not one.
  for (const [field, value] of Object.entries(rule.inputMatches ?? {})) {
    parts.push(`${field} contains /${value}/`);
  }
  return parts.length > 0 ? ` (${parts.join(', ')})` : '';
}
