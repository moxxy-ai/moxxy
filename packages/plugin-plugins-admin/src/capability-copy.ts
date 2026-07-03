import type { CapabilitySpec } from '@moxxy/sdk';

/**
 * The ONE place install-consent copy lives. Both consent surfaces (the TUI
 * post-install picker and the `moxxy plugins install` CLI confirm) and the
 * `moxxy security audit` views render a capability surface through these
 * helpers, so the wording a user consents to is identical everywhere.
 * Mirrors the spirit of desktop-app-sdk's PERMISSION_LABELS: plain sentences
 * a non-expert can act on, never spec-internal jargon.
 */
export interface CapabilitySurfaceRow {
  /** Short human label for the capability axis (e.g. "Read files"). */
  readonly label: string;
  /** Human-readable scope of that axis (globs, hosts, commands, budgets). */
  readonly value: string;
}

/**
 * Human-readable label/value rows for an (aggregated) {@link CapabilitySpec}.
 * Absent axes are skipped — an empty array means the spec declares nothing
 * beyond running in-process. Rendering (padding, colors, bullets) is the
 * caller's job; the copy is fixed here.
 */
export function describeCapabilitySurface(s: CapabilitySpec): ReadonlyArray<CapabilitySurfaceRow> {
  const rows: CapabilitySurfaceRow[] = [];
  if (s.fs?.read?.length) rows.push({ label: 'Read files', value: s.fs.read.join(', ') });
  if (s.fs?.write?.length) rows.push({ label: 'Write files', value: s.fs.write.join(', ') });
  if (s.net) {
    rows.push({
      label: 'Network',
      value:
        s.net.mode === 'allowlist'
          ? `only these hosts: ${s.net.hosts.join(', ')}`
          : s.net.mode === 'any'
            ? 'any host (unrestricted)'
            : 'no network access',
    });
  }
  if (s.env?.length) rows.push({ label: 'Environment', value: `reads ${s.env.join(', ')}` });
  if (s.subprocess) {
    rows.push({
      label: 'Run commands',
      value: s.commands?.length ? s.commands.join(', ') : 'any command',
    });
  }
  if (s.timeMs !== undefined) rows.push({ label: 'Time budget', value: `up to ${formatMs(s.timeMs)} per call` });
  if (s.memMb !== undefined) rows.push({ label: 'Memory', value: `up to ${s.memMb} MB` });
  return rows;
}

/** One-line summary of a surface, for compact info lines after an install. */
export function summarizeCapabilitySurface(s: CapabilitySpec): string {
  const rows = describeCapabilitySurface(s);
  if (rows.length === 0) return 'declares no capabilities';
  return rows.map((r) => `${r.label.toLowerCase()}: ${r.value}`).join(' · ');
}

/**
 * The loud call-out for tools that declared nothing. An undeclared tool's
 * surface is UNKNOWN — not empty — so consent copy must never let "no rows"
 * read as "harmless".
 */
export function undeclaredToolsWarning(undeclared: number, total: number): string {
  const tools = undeclared === 1 ? 'tool declares' : 'tools declare';
  return (
    `${undeclared} of ${total} ${tools} NO capabilities — ` +
    'their surface is unknown, not empty.'
  );
}

function formatMs(ms: number): string {
  if (ms >= 1000 && ms % 1000 === 0) return `${ms / 1000}s`;
  return `${ms}ms`;
}
