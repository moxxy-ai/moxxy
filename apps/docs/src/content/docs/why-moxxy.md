---
title: Why moxxy
description: moxxy vs OpenClaw, pi, and Hermes — the security-serious, fully swappable personal agent.
---

**moxxy is the security-serious, fully swappable personal agent.** Every
block is a registry-backed plugin you can replace: providers, the agent
loop itself (modes), compactors, cache strategies, embedders,
transcribers, isolators, channels. One runner owns the live session, and
many surfaces — TUI, desktop, Telegram, HTTP, mobile — attach to it
concurrently. And security is designed in rather than bolted on:
permission-gated and vault-protected by default, isolatable on demand.

This page positions moxxy against three popular alternatives. Every
factual claim about another project is dated and linked to its source.
No project here is framed as "bad" — they make different trade-offs,
and one of them might fit you better.

## The security story

moxxy's posture in one line: **permission-gated and vault-protected by
default, isolatable on demand.**

- **Permissions, by default.** Every tool call passes through a
  [`PermissionResolver`](/guides/permissions/). Interactive channels
  prompt (allow once / allow always / deny); "allow always" rules are
  learned per tool and persisted to `~/.moxxy/permissions.json`, where
  `deny` rules always win over `allow`. Headless runs are deny-by-default
  unless you pass an explicit allow-list.
- **Secrets, by default.** The built-in [vault](/packages/plugin-vault/)
  encrypts secrets with AES-256-GCM — OS keychain by default, passphrase
  fallback — and configs reference them as `${vault:KEY}` placeholders.
  The model never sees plaintext credentials.
- **Isolation, on demand.** [`@moxxy/plugin-security`](/guides/security/)
  adds capability isolation: tools declare what they need (filesystem
  path globs, network host allow-lists, env keys, time and memory
  budgets) and an `Isolator` enforces those bounds at every call —
  `inproc`, `worker`, `subprocess`, or `wasm`, each with an honest list
  of what it does *not* enforce.

To be clear about the last point: **isolation is opt-in, not on by
default.** Forcing it on would break tools that haven't declared
capabilities yet, and for personal use the permission gate plus the
vault is the sensible floor. The [security guide](/guides/security/)
explains the reasoning and how to turn it on (`security.enabled: true`,
or say yes during `moxxy init`).

## How it compares

Three projects people reasonably consider instead of moxxy. All figures
below were checked in early July 2026 and will drift — treat the linked
sources as authoritative.

|  | moxxy | [OpenClaw](https://github.com/openclaw/openclaw) | [pi](https://github.com/earendil-works/pi) | [Hermes](https://github.com/NousResearch/hermes-agent) |
|---|---|---|---|---|
| Language | TypeScript | TypeScript | TypeScript | Python |
| GitHub stars (July 2026) | small, young project | ~381k | ~67k | ~208k |
| Messaging channels | TUI, desktop, Telegram, HTTP, Slack, mobile | 23 (WhatsApp, Telegram, Slack, Discord, iMessage, …) | terminal-focused | Telegram, Discord, Slack, WhatsApp, Signal + more via one gateway |
| Permission gating | every tool call, by default | allow-lists / pairing per channel | none by design (external containment) | approval hooks |
| Sandboxing / isolation | opt-in capability isolators (inproc/worker/subprocess/wasm) | opt-in, off by default; main session runs on the host | delegated to containers/VMs | delegated to where you run it |
| Swappable agent loop | yes — modes are plugins | no | no | no |
| Multi-surface, one live session | yes (runner protocol) | gateway routes channels to sessions | n/a | gateway with cross-platform continuity |

### vs OpenClaw

[OpenClaw](https://github.com/openclaw/openclaw) is the giant of the
personal-agent space — roughly 381k GitHub stars as of July 2026, 23
messaging channels, voice wake words, and by far the largest community
and skill ecosystem. If you want maximum reach across chat platforms
today, it is the obvious choice.

The trade-off is its default security posture, as of July 2026:

- Sandboxing is opt-in and off by default. OpenClaw's own README states
  that by default "tools run on the host for the `main` session, so the
  agent has full access when it is just you"
  ([README](https://github.com/openclaw/openclaw), sandboxing section).
- Microsoft's Defender research team published
  ["Running OpenClaw safely"](https://www.microsoft.com/en-us/security/blog/2026/02/19/running-openclaw-safely-identity-isolation-runtime-risk/)
  (2026-02-19), recommending it be deployed "only in a fully isolated
  environment such as a dedicated virtual machine" with dedicated,
  non-privileged credentials. (Fairness note: Microsoft ships competing
  agent products, so weigh the source accordingly — but the technical
  recommendations stand on their own.)
- Its ClawHub skills registry was found to host
  [341 malicious skills](https://thehackernews.com/2026/02/researchers-find-341-malicious-clawhub.html)
  by Koi Security in February 2026 (their
  [write-up](https://www.koi.ai/blog/clawhavoc-341-malicious-clawedbot-skills-found-by-the-bot-they-were-targeting)),
  most delivering the Atomic Stealer macOS malware through fake
  "pre-requisite" install steps.

moxxy's bet is the opposite default: the permission gate and vault are
always on, skills are prompt-only Markdown (no install-time code
execution), and plugins are npm packages subject to npm's supply-chain
tooling — with capability isolation available the day you need it.

### vs pi

[pi](https://github.com/earendil-works/pi) (~67k stars, July 2026) is a
deliberately minimal coding-agent toolkit and terminal harness — and an
excellent one. Its README is refreshingly explicit: "Pi does not include
a built-in permission system for restricting filesystem, process,
network, or credential access", and it recommends containerizing or
sandboxing the whole process when you need boundaries
([README](https://github.com/earendil-works/pi), "Permissions &
Containerization").

That is a coherent philosophy, not a flaw: keep the harness tiny and
let the OS do containment. moxxy makes the opposite bet for a
*personal, always-on* agent that reads your Telegram messages and holds
your API keys: gating and secret-handling belong inside the framework,
per tool call, not only around the process. If all you want is a sharp
coding harness in a terminal you already trust, pi is a great pick.

### vs Hermes

[Hermes](https://github.com/NousResearch/hermes-agent) (~208k stars,
July 2026) is Nous Research's Python agent, and its headline feature is
a built-in learning loop: it creates skills from experience, improves
them during use, and builds a persistent model of who you are across
sessions ([README](https://github.com/NousResearch/hermes-agent)). It
reaches Telegram, Discord, Slack, WhatsApp, Signal and more through a
single gateway process.

moxxy has a smaller version of one of those ideas — when no existing
skill matches a prompt, the agent can
[draft a new skill for your approval](/architecture/#skill-model) —
but it does not have Hermes's autonomous self-improvement loop or its
persistent user modeling. If agent-that-learns is your priority, Hermes
is ahead here. moxxy's counter-offer is the typed, swappable
architecture: in Hermes (as in OpenClaw and pi) the agent loop is the
framework's; in moxxy the loop is a plugin you can replace.

## What moxxy does *not* uniquely have

Honesty about the table stakes, as of July 2026:

- **Multi-provider support is common.** OpenClaw and pi both speak
  multiple LLM backends, including reusing existing ChatGPT/Claude
  subscriptions via OAuth — moxxy's provider plugins are convenient,
  not unique.
- **Channel count and community favor the incumbents.** OpenClaw and
  Hermes each support more messaging platforms than moxxy does today,
  and both have communities orders of magnitude larger.
- **moxxy is young.** Smaller ecosystem, fewer integrations, fewer
  eyeballs. The pitch is architecture and security posture, not
  traction.

## What is genuinely distinctive

- **The loop itself is swappable.** Modes are plugins
  (`@moxxy/mode-default`, `@moxxy/mode-goal`,
  `@moxxy/mode-deep-research`) registered like any other block. The
  alternatives let you configure or hook their loop; none lets you
  replace it.
- **The layered security stack.** Per-call permission gating with
  learned rules, an AES-256-GCM vault the model can't see through, and
  opt-in capability isolators — as one coherent, pluggable stack rather
  than a single on/off sandbox.
- **One live session, many surfaces at once.** The
  [runner](/guides/running-as-a-service/) owns the session; TUI,
  desktop, Telegram, and HTTP attach concurrently over the runner
  protocol and see the same conversation in real time.
- **A typed, zero-runtime-dependency SDK.**
  [`@moxxy/sdk`](/packages/sdk/) is the whole contract; plugins are
  ordinary npm packages auto-discovered via `package.json#moxxy.plugin`,
  authored with full IDE support.

If those four are what you're optimizing for, moxxy is the one built
around them. Start with the [Quickstart](/quickstart/).
