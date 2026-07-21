# How Moxxy is built

Moxxy is developed with the agent that the framework itself runs. Approximately 95 percent of the code has been written by Moxxy. This is not a substitute for engineering review; it is the reason the project invests heavily in repeatable validation and clear repository constraints.

## Engineering principles

### Adversarial review

Broad reviews fan out across focused analysis agents. Candidate findings are then passed to independent agents that try to refute them before a human acts on them. This reduces false positives and keeps fixes focused on verified behavior.

### A gate for every change

Build, typecheck, lint, dependency constraints, and the test suite are enforced in CI. Local repository hooks apply the same discipline before an agent can call a task complete.

### Live validation

The live end-to-end workflow drives the real CLI against a real provider. It checks a streaming turn, a tool round trip, and rejection of a cloud metadata address by the SSRF guard. Provider and security behavior are therefore tested beyond fixtures alone.

### A repository that teaches its contributors

The [technical debt journal](../TECH_DEBT.md), focused playbooks in [`.claude/skills/`](../.claude/skills/), and specialized definitions in [`.claude/agents/`](../.claude/agents/) capture decisions close to the code. Each change should leave the repository easier to modify safely.

## What this means for releases

- Changes stay small and single-purpose.
- Claims are tied to code, tests, or reproducible behavior.
- Independent review challenges assumptions before merge.
- CI protects architectural boundaries as well as runtime behavior.
- Live checks cover integrations where mocks are not enough.

The result is an agent-built codebase held to the same production standards expected of a human-built one.

## Learn more

- [Developer guide](developer-guide.md)
- [Security model](../SECURITY.md)
- [Technical debt journal](../TECH_DEBT.md)
- [Contributing](../CONTRIBUTING.md)
