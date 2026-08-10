# Moxxy product contract

Moxxy is a local AI agent for developers that is simple to start, safe to use,
and ready to operate under organizational policy.

This contract decides what the product exposes. The runtime may remain deeply
modular; the default experience must not require users to understand that
architecture.

## Audiences

### Personal developer — primary

A developer wants an agent in a project, using a model account they already
have. They expect it to understand the workspace, ask before consequential
actions, keep useful local context, and become extensible only when needed.

### Governed developer — secondary

An organization wants the same developer experience with centrally supplied
policy, approved model connections and extensions, and inspectable activity.
For the developer alpha, this means a governed developer workstation. It does
not mean a general-purpose enterprise control plane.

## Product promise

Install moxxy, connect a model, open a project, and start working. Moxxy chooses
safe defaults and explains consequential actions before it performs them.

The personal and governed products share one runtime:

- Personal use adds power through optional extensions.
- Governed use constrains the same experience through policy and receipts.

## The concepts users see

The default product vocabulary is deliberately small:

1. **Workspace** — the project moxxy can work in.
2. **Run** — a conversation and its activity.
3. **Model connection** — how moxxy reaches a model.
4. **Approval** — a decision before a consequential action.
5. **Extension** — an optional capability added after the core works.
6. **Policy** — organizational rules applied to governed workstations.

The default experience does not expose modes, loop strategies, compactors,
cache strategies, embedders, isolators, event stores, registries, or plugin
manifests. Those remain extension-author and advanced-operator concepts.

Public product copy says **extension**. Author documentation may use **plugin**
when it refers to the package and SDK contract. Public product copy says
**model connection**. Advanced documentation may use **provider**.

## Personal golden path

The first useful run has four steps:

1. Install the CLI or desktop app.
2. Connect one supported model account.
3. Open or select a workspace.
4. Ask moxxy to explain or change something.

Setup selects the recommended model and runtime defaults automatically. It
does not ask about channels, background services, memory backends, security
isolators, or optional extensions. Those live behind advanced setup.

Success means:

- no configuration file is required;
- no more than two user decisions are required before the first prompt;
- the first safe read-only task works without an approval ceremony;
- a write or command clearly states what will happen and asks once;
- the next run resumes without repeating setup.

## Default surfaces

The CLI leads with `moxxy`, `moxxy onboard`, `moxxy doctor`, and
`moxxy extensions`. Advanced runtime and channel commands remain available but
do not dominate help or onboarding.

The desktop leads with Runs, Extensions, and Settings. Collaboration,
automation, channels, voice, and mobile are optional capabilities, not primary
navigation.

Documentation has three paths:

- **Use** — install, connect a model, work in a project, approve actions.
- **Extend** — add a skill, tool, integration, channel, or model connection.
- **Govern** — enroll a workstation, apply policy, approve extensions, inspect
  receipts.

## Governed contract

Governed moxxy must preserve the personal workflow. Enrollment may add policy,
but it must not turn ordinary use into infrastructure administration.

A governed workstation provides:

- an organization-issued profile;
- allowed model connections and extensions;
- centrally defined tool and data-access policy;
- tamper-evident activity receipts suitable for inspection;
- explicit local indication that policy is active.

The developer alpha describes this contract and supports design partners. It
does not claim fleet management, compliance certification, or a production SLA.

## Extensibility contract

The lightweight core stays useful on its own. Extensions are discovered,
installed, enabled, disabled, and removed through one product concept. Advanced
authors can still replace runtime blocks through the SDK, but the product
introduces that power progressively.

An extension must declare its capabilities, pass through the normal permission
flow, and leave the core usable after removal. Core and SDK dependency
boundaries remain enforced.

## Developer alpha scope

The alpha is ready to invite external developers when all of the following are
true:

- the personal golden path works from a clean machine;
- CLI and desktop use the same product vocabulary;
- the landing page and docs lead with use, then extend, then govern;
- alpha limitations and a feedback route are public;
- install, authentication, first run, approval, and resume have smoke coverage;
- release artifacts can be reproduced through the existing release flow.

Alpha feedback is evaluated against four measures: time to first useful result,
setup completion, first-task completion, and the concepts users report as
confusing. New top-level concepts require evidence from that feedback.

## Non-goals for the alpha

- exposing every runtime extension point in onboarding;
- presenting channels and automation as required setup;
- becoming a hosted multi-tenant agent platform;
- promising a complete enterprise control plane;
- adding features solely to demonstrate architectural flexibility.

When product copy and implementation disagree with this document, either bring
them back into alignment or change this contract deliberately in the same PR.
