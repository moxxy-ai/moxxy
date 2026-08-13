import type { AuditRecord } from '@moxxy/sdk';
import { listAuditDays, readAuditDay, verifyChain } from '@moxxy/core';
import type { ParsedArgv } from '../argv.js';
import { helpRequested, stringFlag } from '../argv-helpers.js';
import { printError } from '../errors.js';
import { colors } from '../colors.js';
import { formatHelp } from './help-format.js';

const HELP = formatHelp({
  title: 'moxxy receipt',
  tagline: 'assemble a verified account of one run from the audit trail',
  sections: [
    {
      title: 'COMMANDS',
      rows: [
        ['receipt <turnId>', 'the account of one turn or triggered run'],
        ['receipt --session <id>', 'every run in a session'],
        ['receipt <turnId> --json', 'machine-readable, for attaching to a ticket'],
      ],
    },
    {
      title: 'NOTES',
      rows: [
        [
          'derived',
          'a receipt is a projection over the audit trail, not a second record. Nothing is written when you ask for one, so asking cannot change what happened.',
        ],
        [
          'verified',
          'the enclosing chain is checked before anything is printed. A receipt from a broken chain says so instead of quietly reporting a subset.',
        ],
      ],
    },
  ],
});

interface Receipt {
  readonly turnId: string;
  readonly sessionId: string;
  readonly startedAt: string;
  readonly endedAt: string;
  readonly actor: string;
  readonly trigger: string;
  readonly policyFingerprint: string | null;
  readonly toolsRequested: ReadonlyArray<string>;
  readonly denials: ReadonlyArray<{ readonly tool: string; readonly reason: string }>;
  readonly failures: number;
  readonly tokens: { readonly input: number; readonly output: number };
  readonly chainVerified: boolean;
  readonly recordCount: number;
}

export async function runReceiptCommand(argv: ParsedArgv): Promise<number> {
  if (helpRequested(argv)) {
    process.stdout.write(HELP);
    return 0;
  }
  const sessionFilter = stringFlag(argv, 'session');
  const turnId = argv.positional[0];
  if (!turnId && !sessionFilter) {
    printError('receipt requires a turn id, or --session <id>');
    return 2;
  }

  const days = await listAuditDays();
  if (days.length === 0) {
    printError('no audit trail found. Enable it with `audit.enabled: true`.');
    return 1;
  }

  // Verify each day's chain BEFORE selecting records. A receipt assembled from
  // a broken chain would look complete while silently omitting whatever was
  // removed, which is worse than refusing.
  const all: AuditRecord[] = [];
  let chainVerified = true;
  for (const day of days) {
    const records = await readAuditDay(day);
    if (!verifyChain(records).ok) chainVerified = false;
    all.push(...records);
  }

  const matching = all.filter((r) =>
    sessionFilter ? r.sessionId === sessionFilter : r.turnId === turnId,
  );
  if (matching.length === 0) {
    printError(
      `no audit records for ${sessionFilter ? `session ${sessionFilter}` : `turn ${turnId}`}. ` +
        'Retention may have pruned them, or the run predates `audit.enabled`.',
    );
    return 1;
  }

  const policy = all.find((r) => r.action === 'policy' && r.sessionId === matching[0]!.sessionId);
  const byTurn = new Map<string, AuditRecord[]>();
  for (const r of matching) {
    const bucket = byTurn.get(r.turnId);
    if (bucket) bucket.push(r);
    else byTurn.set(r.turnId, [r]);
  }

  const receipts = [...byTurn.entries()].map(([id, records]) =>
    buildReceipt(id, records, policy, chainVerified),
  );

  if (argv.flags.json === true) {
    process.stdout.write(JSON.stringify(receipts.length === 1 ? receipts[0] : receipts, null, 2) + '\n');
  } else {
    for (const r of receipts) process.stdout.write(render(r));
  }
  // Exit non-zero on a broken chain so a compliance job can gate on the
  // receipt's trustworthiness, not merely on its existence.
  return chainVerified ? 0 : 1;
}

export function buildReceipt(
  turnId: string,
  records: ReadonlyArray<AuditRecord>,
  policy: AuditRecord | undefined,
  chainVerified: boolean,
): Receipt {
  const detail = (r: AuditRecord): Record<string, unknown> => r.detail ?? {};
  const first = records[0]!;
  const tools = records.filter((r) => r.action === 'tool.request');
  const denials = records
    .filter((r) => r.action === 'tool.denied')
    .map((r) => ({
      tool: String(detail(r).tool ?? detail(r).callId ?? 'unknown'),
      reason: String(detail(r).reason ?? 'unspecified'),
    }));
  const usage = records.filter((r) => r.action === 'usage');
  const prompt = records.find((r) => r.action === 'prompt');

  return {
    turnId,
    sessionId: first.sessionId,
    startedAt: new Date(records[0]!.ts).toISOString(),
    endedAt: new Date(records[records.length - 1]!.ts).toISOString(),
    // An unattributed run is itself worth reporting: it means the surface could
    // not establish who was acting.
    actor: first.actor ? `${first.actor.issuer}:${first.actor.id}` : 'unattributed',
    trigger: prompt ? String(detail(prompt).origin ?? 'human') : 'unknown',
    policyFingerprint: policy ? String(detail(policy).fingerprint ?? '') || null : null,
    toolsRequested: tools.map((r) => String(detail(r).tool ?? 'unknown')),
    denials,
    failures: records.filter((r) => r.action === 'tool.result' && detail(r).ok === false).length,
    tokens: {
      input: usage.reduce((n, r) => n + Number(detail(r).inputTokens ?? 0), 0),
      output: usage.reduce((n, r) => n + Number(detail(r).outputTokens ?? 0), 0),
    },
    chainVerified,
    recordCount: records.length,
  };
}

function render(r: Receipt): string {
  const rows: Array<readonly [string, string]> = [
    ['turn', r.turnId],
    ['session', r.sessionId],
    ['when', `${r.startedAt} to ${r.endedAt}`],
    ['actor', r.actor],
    ['trigger', r.trigger],
    ['policy', r.policyFingerprint ? r.policyFingerprint.slice(0, 16) : '(not recorded)'],
    ['tools', r.toolsRequested.length > 0 ? r.toolsRequested.join(', ') : '(none)'],
    ['denied', r.denials.length > 0 ? r.denials.map((d) => `${d.tool}: ${d.reason}`).join('; ') : '(none)'],
    ['failed', String(r.failures)],
    ['tokens', `${r.tokens.input} in / ${r.tokens.output} out`],
    ['records', String(r.recordCount)],
  ];
  const width = Math.max(...rows.map(([k]) => k.length));
  const body = rows.map(([k, v]) => `  ${colors.bold(k.padEnd(width))}  ${v}`).join('\n');
  const chain = r.chainVerified
    ? colors.dim('  chain verified')
    : colors.red('  CHAIN BROKEN: this receipt may be missing records');
  return `${body}\n${chain}\n\n`;
}
