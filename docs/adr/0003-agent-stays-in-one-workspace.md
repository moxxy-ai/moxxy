---
status: accepted
---

# An agent stays in one workspace and has one conversation

An agent is created in a workspace (or in Home), stays there, and has a single
conversation for as long as it exists. There is no "new chat" with the same
agent and no moving an agent to another workspace; to get the same kind of
agent elsewhere, a person copies its profile into a new agent. We chose this
because it is what a messenger feels like, and because it makes it impossible
for one project's context to leak into another.

## Considered Options

- **One agent present in several workspaces, with a conversation in each.**
  Rejected: the person no longer knows which conversation "the agent" is, and
  it contradicts one conversation for life.
- **One agent that moves between workspaces and takes its conversation along.**
  Rejected: the conversation would carry one project's files, names and
  decisions into the next, which is what degrades the work.
- **Many disposable conversations per workspace, as before.** Rejected: every
  conversation started from nothing and people had to hunt for the right one.

## Consequences

- Working on several things at once in one workspace means several agents, not
  several conversations with one agent.
- Existing conversations are kept: in each workspace the most recent one
  becomes the default agent's conversation and the rest become read-only
  earlier conversations that history can search.
- A conversation grows without bound, so reading it must never require loading
  all of it.
