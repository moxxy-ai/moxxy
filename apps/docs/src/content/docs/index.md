---
title: Introduction
description: moxxy is a local AI agent for developers, with optional extensions and governed workstation controls.
---

**moxxy** is a local AI agent for software work. Connect a model account,
launch it in a project, and start with sensible defaults. It understands the
workspace, persists runs locally, and asks before consequential actions.

Moxxy is currently a **developer alpha**. The primary path is personal use by a
developer; governed workstation profiles are available as a design-partner
preview.

## Use

```sh
npm install -g @moxxy/cli
cd your-project
moxxy onboard
moxxy
```

Onboarding asks for one model connection and authentication. It does not ask
you to configure the runtime architecture. Continue with the
[Quickstart](./quickstart.md).

## Extend

The core works without optional packages. When you need another capability,
use `moxxy extensions` or add a Markdown skill. Extension authors get the typed,
zero-runtime-dependency `@moxxy/sdk` contract.

Advanced documentation still describes providers, modes, tools, compactors,
cache strategies, embedders, isolators, and channels. Those are author and
operator concepts, not first-run decisions.

## Govern

An organization can apply approved model connections, extensions, tool policy,
network constraints, and audit export to the same local workstation
experience. See the security and deployment guides before treating this alpha
as a managed environment.

Read [Developer alpha](./developer-alpha.md) for supported paths, limitations,
and the feedback format.
