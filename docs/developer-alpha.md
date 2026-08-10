# Developer alpha

Moxxy's developer alpha validates one promise: a developer can install a local
agent, connect a model account, get useful work done in a project, understand
approvals, and resume the run without learning the runtime architecture.

## In scope

- macOS and Linux CLI use on Node.js 20.10 or newer;
- the desktop app on supported release platforms;
- Anthropic and OpenAI API keys;
- ChatGPT OAuth and an existing Claude Code subscription session;
- local workspace read, edit, command, and search tools;
- approvals, persisted sessions, and the default local memory path;
- optional extensions after the first successful run;
- governed workstation profiles as a design-partner preview.

## Still experimental

- channel and background-service setup;
- collaboration, automations, voice, mobile, and agent-authored apps;
- third-party extensions and non-default runtime blocks;
- organization-wide enrollment and remote audit export;
- packaged desktop self-update across every environment.

Experimental features remain available behind advanced CLI commands or the
desktop's **More** menu. They should not block the personal golden path.

## What feedback helps

For first-run feedback, include:

1. OS, architecture, Node version, and install method.
2. The model connection selected; never include a key or token.
3. Time from install to the first useful answer.
4. The first task attempted and whether it completed.
5. Any word, decision, or approval that was unclear.
6. Whether the next launch resumed as expected.

Report reproducible bugs in
[GitHub Issues](https://github.com/moxxy-ai/moxxy/issues). Use
[GitHub Discussions](https://github.com/moxxy-ai/moxxy/discussions) for product
feedback and use cases.

## Exit criteria

The alpha can move forward when clean-machine smoke tests cover install,
authentication, first read-only task, first approved write, and resume; most
testers finish setup without editing config; and the dominant feedback is about
task quality rather than setup concepts.

Alpha means APIs and extension contracts may still change. Release notes and
changesets document those changes; production guarantees and compliance claims
are out of scope.
