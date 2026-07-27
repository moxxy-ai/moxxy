/**
 * Deployment profiles: a starting config an operator installs, rather than a
 * new code path.
 *
 * A profile is only ever TEXT. It deliberately does not mutate anything by
 * itself, because the file it belongs in (`/etc/moxxy/config.yaml`) is
 * root-owned and site-specific: the operator has to read it, fill in the parts
 * only they know (proxy URL, audit sink, internal registry), and place it. A
 * command that silently wrote a machine-wide security policy would be doing
 * the reviewing for them.
 */

export interface ProfileDef {
  readonly name: string;
  readonly description: string;
  /** Where this profile is meant to live, for the printed instructions. */
  readonly target: string;
  readonly yaml: string;
}

/**
 * The enterprise baseline.
 *
 * Every `locked:` entry is a control a user must not be able to switch off on
 * their own machine. Everything NOT locked is either site-specific (the proxy
 * URL) or a preference that carries no security weight, and locking those would
 * only generate support tickets.
 *
 * Left deliberately unset, with comments instead of values: the proxy URL, the
 * audit sink, and the plugin registry. A profile that guessed those would be
 * wrong everywhere, and a wrong proxy is indistinguishable from an outage.
 */
const ENTERPRISE = `# moxxy enterprise baseline.
#
# Place at /etc/moxxy/config.yaml (or %PROGRAMDATA%\\moxxy\\config.yaml, or the
# path in $MOXXY_SYSTEM_CONFIG). This is the SYSTEM scope: it loads before the
# user and project configs, and the keys under \`locked:\` are stripped from
# those layers, so a user cannot turn them off.
#
# Review before installing. The commented entries are site-specific and have no
# safe default.

security:
  # Enforce declared capabilities at every tool call.
  enabled: true
  # Refuse tools that declare no capabilities at all.
  requireDeclaration: true
  # Deny undeclared tools from packages outside the @moxxy scope.
  thirdPartyRequireDeclaration: enforce
  # Fail closed when a path or URL arrives under an unrecognised field name.
  strict: true

plugins:
  isolator:
    # A real process boundary. 'inproc' is best-effort only and cannot contain
    # a hostile plugin; 'worker' is the lighter middle ground.
    default: subprocess

config:
  # Never execute a project's moxxy.config.ts. Only YAML data is loaded.
  allowExecutable: false

audit:
  enabled: true
  # 'local' is the hash-chained file under ~/.moxxy/audit. It is tamper-EVIDENT
  # (it detects silent deletion) but not tamper-proof, because whoever can write
  # the file can recompute the chain. Point this at a remote sink to get a chain
  # head the workstation cannot rewrite.
  # sink: <your-sink>
  retentionDays: 400
  # Prompt TEXT is off by default; only its length and SHA-256 are recorded, so
  # a prompt stays provable without the trail disclosing business content.
  # Turn on only if your retention policy accounts for it.
  includePromptText: false

channels:
  mobile:
    # Loopback, not the LAN. The mobile channel binds 0.0.0.0 by default so a
    # physical phone works out of the box; on a corporate laptop that puts a
    # token-gated listener on the office network. Pair over a tunnel instead.
    bindHost: 127.0.0.1

# network:
#   # 'env' (the default) reads http_proxy/https_proxy/no_proxy. Pin a URL here
#   # to stop a user routing around the proxy by clearing their shell profile.
#   proxy: http://proxy.example.internal:3128
#   noProxy: .example.internal,localhost
#
# Set NODE_EXTRA_CA_CERTS in the environment when the proxy terminates TLS.
# Node reads it at startup, so it cannot be configured here.

locked:
  - security.enabled
  - security.requireDeclaration
  - security.thirdPartyRequireDeclaration
  - security.strict
  - plugins.isolator
  - config.allowExecutable
  - audit
  - channels.mobile.bindHost
`;

export const PROFILES: ReadonlyArray<ProfileDef> = [
  {
    name: 'enterprise',
    description: 'managed workstation: isolation enforced, no executable configs, audit on',
    target: '/etc/moxxy/config.yaml',
    yaml: ENTERPRISE,
  },
];

export function findProfile(name: string): ProfileDef | undefined {
  return PROFILES.find((p) => p.name === name);
}
