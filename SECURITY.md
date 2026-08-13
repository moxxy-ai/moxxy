# Security

moxxy runs an autonomous agent with real tools on your machine. This document describes the security model honestly — what is enforced by default, what is opt-in, and how to harden a deployment — plus how to report a vulnerability.

## Reporting a vulnerability

**Please do not open a public issue for security reports.**

Report privately via [GitHub's private vulnerability reporting](https://github.com/moxxy-ai/moxxy/security/advisories/new) ("Report a vulnerability" on the Security tab). You should receive an initial response within 72 hours. Please include reproduction steps and the affected version (`moxxy --version`).

Only the latest published release line receives security fixes.

For a full review: [threat model](docs/threat-model.md) (what each control is worth, and where a name promises more than the mechanism delivers), [what leaves the machine](docs/data-flow.md), and [deploying in an organisation](docs/deployment.md).

## The security model

One sentence: **moxxy is permission-gated and vault-protected by default, and isolatable on demand.**

### Enforced by default

- **Per-tool permission gating.** Every tool call passes through the permission engine before it runs. Interactive channels prompt; "allow always" answers become persisted policy rules (`~/.moxxy/permissions.json`, deny-before-allow, fail-closed on malformed rules). Headless/autonomous channels are deny-by-default and run against an explicit allow-list.
- **Secrets vault.** API keys and channel tokens live in an AES-256-GCM vault (`moxxy vault`), unlocked via the OS keychain. Where no keychain exists the master key is generated and stored beside the vault at `0600` rather than demanding a passphrase, which protects a key from leaking through config, a transcript, or a log, but not from someone who can already read that file; `vault.requirePassphrase: true` raises that bar. Config and tools reference secrets as `${vault:KEY}` placeholders, resolved at the boundary where they are used, so **the model never sees plaintext secrets** and they never appear in the transcript or event log.
- **Channel authentication.** Every remote surface is gated: Telegram/Slack pair explicitly (code/QR/TOFU) and drop unpaired traffic; HTTP/WebSocket channels require bearer tokens (generated, never empty, constant-time compared); webhook ingestion verifies HMAC signatures over raw bytes with replay windows before parsing; inbound payloads are schema-validated and size-capped before they reach a session.
- **Install-time script ban.** `moxxy plugins install` runs npm with `--ignore-scripts`, so a package's (and its dependencies') `preinstall`/`install`/`postinstall` hooks never execute. Version pinning from the signed registry does not cover this on its own: a signature over the index says nothing about what a tarball's install script does. An explicit human `--allow-scripts` lifts the ban for one install (native modules that compile or fetch a binding); the `install_plugin` model tool cannot reach that flag.
- **Owner-only state.** `~/.moxxy` is created `0700`, and session transcripts, their metadata sidecars, and the permission policy are written `0600` (existing looser files are tightened in place on next use). A transcript holds every prompt, every file the agent read, and every command's output, so on a shared host it must not be readable by another local account.
- **SSRF guards.** `web_fetch` refuses link-local/metadata and private-range addresses.
- **Signed desktop updates.** Desktop hot-update bundles are signature-verified against a key baked into the immutable bootstrap before activation.

### Opt-in (not enabled by default)

- **Capability isolation.** Tools can declare what they need (`isolation: { capabilities }` — fs path globs, net host allow-list, env keys, time/memory budgets). With `security.enabled: true`, an Isolator enforces those bounds at every call — `inproc` checks in-process; `worker`, `subprocess`, and `wasm` isolators enforce at a real boundary. In-process enforcement is best-effort by design; use an out-of-process isolator where it matters.
- **`requireDeclaration`.** Refuse to run tools that declare no capabilities at all.

We deliberately do not claim "sandboxed by default." If your threat model includes malicious or compromised plugins, enable security in `moxxy init` or set `security.enabled: true` and pick a stronger isolator.

## Trust boundaries to understand

- **Model output is untrusted input.** The permission engine exists because anything the model asks to do may be the product of prompt injection from content it read. Treat allow-always rules as standing authorization — grant them narrowly.
- **Third-party plugins run in-process by default.** `moxxy plugins install` executes npm install; installed code loads into the runner. Install-time hooks are blocked (see above), but the plugin's own module code runs in-process once loaded. Install plugins you trust, review their declared capabilities (`moxxy security audit`), and prefer isolation for anything unfamiliar.
- **Autonomous channels are standing exposure.** A channel that runs turns without a human in the loop (Slack allow-list mode, webhooks, cron) should run on a dedicated runner with a minimal tool allow-list — supported out of the box (`dedicatedRunner`).

## Hardening checklist

1. `security.enabled: true` with the `subprocess` (or `worker`) isolator.
2. Keep autonomous channels on dedicated runners; keep their allow-lists minimal (never `['*']`).
3. Don't put secrets in config or env when the vault can hold them — use `${vault:KEY}`.
4. Rotate channel tokens periodically (`rotateChannelToken`; stale tokens warn after 90 days).
5. Enable `audit.enabled` where runs must be accountable after the fact; `moxxy receipt <turnId>` then explains any single run, and both it and `moxxy security audit-log` exit 1 on a broken chain.
6. Review `~/.moxxy/permissions.json` occasionally — prune allow rules you no longer need.
7. Keep moxxy current (`moxxy update`); only the latest release line receives fixes.
