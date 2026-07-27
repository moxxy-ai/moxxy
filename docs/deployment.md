# Deploying moxxy in an organisation

From nothing to a workstation you can prove is configured, and a fleet that stays that way.

Read [threat-model.md](threat-model.md) first if you are the person approving this. It says what each control is worth, including where a name promises more than the mechanism delivers.

## The shape of a managed install

Three layers, and the split matters:

1. **A system config** you own, at `/etc/moxxy/config.yaml`. Loads before anything else and can pin settings a user cannot change.
2. **A plugin manifest** you version-control. Declares which modules a machine runs.
3. **Everything else is the user's.** Their provider choice, their model, their preferences. Locking those generates support tickets and buys nothing.

The kernel arrives close to empty and people add modules. That is the intended shape: what a machine runs should be a decision someone wrote down, not an accumulation.

## 1. Install the baseline

`moxxy profile enterprise` prints a system config with the security-relevant settings already set and locked. It only prints. The file is root-owned and carries site-specific entries with no safe default, so you review it and place it.

```sh
moxxy profile enterprise                # read it
moxxy profile enterprise | sudo tee /etc/moxxy/config.yaml
```

What the baseline turns on:

| Setting | Effect |
|---|---|
| `security.enabled` + `requireDeclaration` | Capabilities enforced at every tool call; tools declaring none are refused |
| `security.thirdPartyRequireDeclaration: enforce` | Undeclared tools outside the `@moxxy` scope are denied |
| `plugins.isolator.default: subprocess` | A real process boundary, not the best-effort in-process check |
| `plugins.installPolicy: registry-only` | Only packages the signed index vouches for |
| `config.allowExecutable: false` | A project's `moxxy.config.ts` is never executed |
| `audit.enabled` | Hash-chained trail under `~/.moxxy/audit/` |
| `channels.mobile.bindHost: 127.0.0.1` | Loopback, not the office LAN |

Everything under `locked:` is stripped from the user, project, and explicit layers before merging, and the attempt is reported. Everything **not** locked is either site-specific or carries no security weight.

### Fill in what only you know

The profile ships these commented out because a guess would be wrong everywhere, and a wrong proxy is indistinguishable from an outage:

```yaml
network:
  proxy: http://proxy.corp.example:3128
  noProxy: .corp.example,localhost

plugins:
  registryUrl: https://registry.example.internal/moxxy/index.json

audit:
  sink: <your-remote-sink>
```

If the proxy terminates TLS, set `NODE_EXTRA_CA_CERTS` in the machine environment. Node reads it at startup, so it cannot go in config.

## 2. Decide where secrets come from

The built-in vault is fine for one machine and has no central issuance, no rotation, and no per-machine revocation. If you already run HashiCorp Vault, AWS Secrets Manager, Azure Key Vault or 1Password, plug it in:

```yaml
plugins:
  secretProvider:
    default: <provider-name>
```

Resolution falls back to the local vault for anything the provider does not hold, so you can move secrets over one at a time instead of in a big bang. A provider that is unreachable raises an error rather than silently falling through, because a machine quietly running on credentials you believe you revoked is worse than a failure.

Users are never asked to invent a passphrase. Where no OS keychain exists the master key is generated and stored at `0600`. Set `vault.requirePassphrase: true` if you want the stronger posture.

## 3. Declare the plugin set

`plugins.packages` is the manifest. Commit it with a project, or push it from the system scope, and every machine converges on the same set.

```yaml
plugins:
  packages:
    '@moxxy/plugin-memory': { enabled: true }
    '@moxxy/plugin-telegram': { enabled: false }
```

```sh
moxxy sync            # install what is declared and missing
moxxy sync --check    # report drift, exit 1, change nothing
```

`--check` fails only on **missing** packages, so it works as a provisioning gate in CI without failing on a local extra. Sync never removes: a package a user installed is theirs to remove.

With `installPolicy: registry-only`, `moxxy sync` is the supported way to add a module. Ad-hoc `plugins install` of anything outside the signed index is refused, including by the agent's own `install_plugin` tool.

### Authenticating to an internal mirror

Store the credential under the host convention and whatever secret provider is active will serve it:

```
registry.example.internal  ->  MOXXY_CREDENTIAL_REGISTRY_EXAMPLE_INTERNAL
```

Authentication decides whether the index is reachable. The signature still decides whether it is trusted.

## 4. Verify the machine

```sh
moxxy doctor
```

Check these lines specifically:

| Line | What you want |
|---|---|
| `config` | `system:/etc/moxxy/config.yaml` appears among the sources |
| `identity` | `os:<user>@<host>`, not `unattributed` |
| `network` | your proxy, and an extra CA if it terminates TLS |
| `vault` | `keychain`, or a note that a stored key is in use |

Then confirm the locks actually bind, rather than trusting that they were written:

```sh
moxxy config get security.enabled          # true
echo 'security: {enabled: false}' >> ~/.moxxy/config.yaml
moxxy config get security.enabled          # still true, with an override warning
```

That last step is worth doing once per rollout. A locked key that was misspelled looks exactly like a locked key that works.

## 5. Wire up the audit trail

The local floor is hash-chained and owner-only:

```sh
moxxy security audit-log            # verify every day's chain
moxxy security audit-log 2026-07-27 # one day
```

Exit code 1 on a broken chain, so a scheduled check can gate on it.

This is tamper-**evident**, not tamper-proof: whoever can write the file can recompute the chain. It catches silent selective deletion, which is the realistic threat. For a chain head the workstation cannot rewrite, point `audit.sink` at a remote sink.

### Accounting for a single run

The trail answers "what happened on this machine". When someone asks about one specific run, usually because it did something surprising, use a receipt:

```sh
moxxy receipt <turnId>            # one run
moxxy receipt --session <id>      # every run in a session
moxxy receipt <turnId> --json     # to attach to a ticket
```

```
  turn     t1
  actor    os:alice@host
  trigger  webhook:deploy
  policy   6c59b147041aab80
  tools    Read, Edit
  denied   Bash: managed policy
  tokens   1200 in / 340 out
  chain verified
```

A receipt is a projection over the trail, not a second record, so asking for one writes nothing and cannot change what it reports. It answers the four questions asked after the fact: who acted, what set it off, which rules were in force, and what it cost.

The `policy` line is the fingerprint recorded at session start over the settings that decide what the agent may do. Identical fingerprints on two runs prove they executed under the same rules; a differing one tells you the rules moved between them. It covers no secrets and no paths, only counts and effective values, so it is safe to paste into a ticket.

The chain is verified before anything prints, and a broken one exits 1 with the receipt marked. That matters more than it sounds: a receipt assembled from a trail with a record deleted would otherwise look complete while quietly omitting the removed call.

Records are bounded and redacted. Prompt text is not recorded unless you set `audit.includePromptText: true`; the SHA-256 always is, so a specific prompt stays provable without the trail disclosing business content. Set `audit.retentionDays` deliberately: keeping everything forever is its own compliance problem.

## 6. Autonomous surfaces

A channel that runs turns with no human in the loop (Slack allow-list mode, webhooks, cron) is standing exposure. Put each on a dedicated runner with a minimal tool allow-list, which is supported out of the box via `dedicatedRunner`. Never use `['*']`.

Permission rules pushed from the system scope apply to these too, and cannot be removed by an "allow always" answer:

```yaml
permissions:
  deny:
    - name: Read
      inputPathPrefix: { path: /etc }
      reason: managed policy
```

Prefer `inputPathPrefix` and `inputGlob` over `inputMatches`: the latter is an unanchored regex, so `{ path: '/etc' }` means "contains /etc anywhere", which over-blocks as a deny and over-grants as an allow.

## Rollout checklist

- [ ] `/etc/moxxy/config.yaml` placed, proxy and CA filled in
- [ ] `moxxy doctor` clean on a pilot machine
- [ ] A locked key verified to actually resist a user override
- [ ] Secret provider chosen, or the local vault accepted deliberately
- [ ] `plugins.packages` committed; `moxxy sync --check` green in CI
- [ ] `installPolicy` set, and an internal mirror pinned if you have one
- [ ] Audit sink configured, retention set, chain verification scheduled
- [ ] Autonomous channels on dedicated runners with minimal allow-lists
- [ ] [threat-model.md](threat-model.md) and [data-flow.md](data-flow.md) reviewed by whoever signs off

## Upgrades

Releases go out daily from `development`. `moxxy update` upgrades the CLI; on a managed fleet, pin the version through your own package management instead and let `moxxy sync` reconcile plugins.

The TUI checks `registry.npmjs.org` for a newer version on start. It sends only the installed version, and it is the single unattended outbound request moxxy makes. See [data-flow.md](data-flow.md).
