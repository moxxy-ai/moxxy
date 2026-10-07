---
status: accepted
---

# Moxxy is a general personal agent, not a developer-only tool

Moxxy was positioned as "a local AI agent for developers", and that did not
hold up: the product was too complicated for the people who wanted to use it.
We decided that moxxy is an agent a person delegates everyday work to (mail,
clients, documents, publishing) and that can also build software. The runtime
and every existing capability stay; what changes is what the default experience
leads with.

## Considered Options

- **Stay developer-only and simplify the screens.** Rejected: the people asking
  for moxxy want one agent for all their work, and a developer-only promise
  keeps a project folder and runs in front of them.
- **Ship a second, simpler product beside the developer one.** Rejected: two
  products over one runtime drift apart, and a developer also wants the
  delegating experience.

## Consequences

- [PRODUCT.md](../../PRODUCT.md) changes its promise, its primary audience and
  its golden path: the first start must not require choosing a project folder.
- Logs, files, code, model choice and the other developer capabilities remain
  reachable, one step behind the conversation rather than in front of it.
