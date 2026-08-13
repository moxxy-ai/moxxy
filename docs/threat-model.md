# Threat model

What moxxy defends against, what it does not, and where each boundary actually sits.

Written to be usable in a security review. Where a control is weaker than its name suggests, this document says so, because a threat model that only lists strengths is a marketing page and gets treated as one.

## What moxxy is

An autonomous agent that runs real tools on a real machine: it reads and writes files, executes shell commands, reaches the network, and installs code. Every control below exists because that is the starting position. Nothing here makes the agent safe to run against a hostile prompt with no boundaries; the controls decide **how far** a bad instruction gets.

## Adversaries considered

| # | Adversary | Considered | Notes |
|---|---|---|---|
| A1 | Prompt injection through content the agent reads | Yes | The primary one. A web page, a file, a webhook payload can all carry instructions. |
| A2 | A malicious or compromised third-party plugin | Yes | Install-time and load-time treated separately; they are different problems. |
| A3 | A user routing around their own organisation's policy | Yes | This is what the system config scope and locked keys exist for. |
| A4 | Another local account on a shared host | Partly | File modes address disclosure. A local attacker with the same uid is out of scope. |
| A5 | A network attacker between moxxy and a provider | Partly | TLS plus optional egress pinning. No certificate pinning. |
| A6 | Someone with root, or with the user's own uid | **No** | Out of scope, and no control here should be read as addressing it. |
| A7 | A malicious model provider | **No** | You are sending them your prompts. Choose accordingly. |

## Trust boundaries

### Model output is untrusted input

The permission engine exists because anything the model asks to do may be the product of injection from content it read. This is the boundary everything else hangs off.

Consequences worth internalising:

- An "allow always" answer is **standing authorization**, granted by a human who was reading one specific request. Grant them narrowly.
- Tool handlers deliberately contain no "is this safe" checks. They trust that `dispatchToolCall` hooks, the permission engine, and the active resolver already ran. Adding ad-hoc checks inside handlers would create a second, drifting policy.
- Headless and autonomous channels are deny-by-default and run against an explicit allow-list, because there is no human to ask.

### The config a directory carries is code

`moxxy.config.ts` is executed with the user's full privileges, before the permission engine, the vault, or any isolator exists. The project search also walks upward. Entering a cloned repository therefore used to run a stranger's code with no signal.

Consent is now required and is keyed to file **content**, so editing an approved config asks again. A non-interactive run refuses rather than executing unreviewed code. `config.allowExecutable: false` forbids it outright.

The system config scope is YAML only for the same reason: an executable file in a root-owned directory that was ever writable by a non-admin would be a privilege-escalation path.

### Install time and load time are different problems

`moxxy plugins install` shells out to npm. Two distinct exposures:

- **Install time.** Lifecycle scripts (`preinstall`/`install`/`postinstall`) of the package *and every transitive dependency* would run with the user's privileges, before the package's declared capabilities are ever read. This is blocked: npm runs with `--ignore-scripts`. An explicit human `--allow-scripts` lifts it for one install; the `install_plugin` model tool cannot reach that flag, so a prompt-injected model cannot talk its way into install-time execution.
- **Load time.** Once installed, a plugin's module code runs **in-process** by default. Capability isolation is opt-in. If your threat model includes hostile plugins, set `security.enabled: true` with an out-of-process isolator.

Version pinning from the signed registry does not cover install time. A signature over the index says nothing about what a tarball's install script does.

### The organisation sits above the user

The system config scope (`/etc/moxxy/config.yaml`) loads first, and its `locked:` dot-paths are stripped from the user, project, and explicit layers before merging. Permission rules supplied in config form an immutable layer above `~/.moxxy/permissions.json`: checked first, never written back, and not removable by editing that file, by answering "allow always", or by deleting it.

This assumes the operator controls `/etc`. On a machine where the user is root, it is documentation rather than enforcement, and should be read that way.

## Controls, and what each is actually worth

### Enforced by default

| Control | Defends against | Does **not** defend against |
|---|---|---|
| Per-tool permission gating | A1, A2 (at call time) | A human who approves everything |
| Install-time script ban | A2 at install | The plugin's own code once loaded |
| Owner-only state (`0700`/`0600`) | A4 disclosure | A6 |
| Channel authentication (tokens, HMAC, pairing) | Unauthenticated remote traffic | A stolen token |
| SSRF guards on `web_fetch` | Metadata and private-range access via A1 | A tool that reaches the network by other means |
| Signed desktop updates | A tampered update bundle | A compromised signing key |

### Opt-in

| Control | Turn it on with | Notes |
|---|---|---|
| Capability isolation | `security.enabled: true` | `inproc` is best-effort **in-process** and cannot contain hostile code. Use `subprocess` or `worker` where it matters. |
| `requireDeclaration` | `security.requireDeclaration: true` | Refuses tools that declare no capabilities. |
| Install policy | `plugins.installPolicy` | `registry-only` accepts only signed-index packages; `denied` blocks runtime installs entirely. |
| Audit trail | `audit.enabled: true` | See the honesty note below. |
| Egress pinning | `network.proxy` | Config beats the environment, so a user cannot route around it by clearing their shell profile. |
| External secret store | `plugins.secretProvider.default` | Central issuance, rotation and per-machine revocation, which the local vault cannot offer. |

`moxxy profile enterprise` prints a baseline with the security-relevant ones set and locked.

## Where the honest limits are

These are the places where a name promises more than the mechanism delivers. Read them before quoting any control in an approval.

**The audit trail is tamper-EVIDENT, not tamper-proof.** Records are hash-chained, so removing or editing one breaks every hash after it and `moxxy security audit-log` reports where. But whoever can write the file can recompute the whole chain. What this catches is silent, selective deletion, which is the realistic threat: an operator or an agent quietly dropping the one line that recorded what they did. Genuine tamper-proofing needs the chain head somewhere the workstation cannot rewrite, which is what a remote sink provides.

**The vault protects against leakage, not against local access.** Secrets are encrypted at rest, and `${vault:KEY}` placeholders resolve at the point of use, so plaintext never enters the model's context, the transcript, or the event log. That is the threat it addresses: a key committed to git, pasted into a log, or captured in a transcript. When no OS keychain is available the master key is generated and stored beside the vault at `0600`, which does **not** protect against anyone who can already read that file. An OS keychain or `vault.requirePassphrase: true` raises that bar.

**In-process isolation is best-effort by construction.** The `inproc` isolator checks declared capabilities inside the same process as the code it is checking. It catches mistakes and honest bugs. It does not contain an adversary. This is why we do not claim "sandboxed by default".

**Permission `inputMatches` patterns are unanchored.** `{ Read: { path: '/etc' } }` means "contains /etc anywhere", not "under /etc". That is a deliberate, stable contract because existing policy files depend on it. Organisation policy should use `inputPathPrefix` (path-segment aware, normalises `..`) or `inputGlob` (anchored) instead.

**Redaction reduces exposure; it does not sanitise.** Secret-named fields are masked, and secret-shaped values are masked inside ordinary fields such as a Bash `command`. Neither is complete. Do not treat redacted output as safe to publish.

**Registry authentication is not registry trust.** A credential lets moxxy *reach* an internal mirror. The Ed25519 signature still decides whether the bytes are trusted, so an authenticated mirror serving an unsigned index is refused exactly like an anonymous one.

## Reporting

Security reports go through [GitHub private vulnerability reporting](https://github.com/moxxy-ai/moxxy/security/advisories/new), not public issues. See [SECURITY.md](../SECURITY.md).
