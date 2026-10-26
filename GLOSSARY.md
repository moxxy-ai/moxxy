# Moxxy

A local AI agent for developers. This glossary holds the words the product and its contributors use for the same things.

## Model connections

**Model connection**:
How Moxxy reaches a model. Every connection is either an API connection or an agent connection.
_Avoid_: provider (in product copy), backend

**API connection**:
A model connection where Moxxy runs the work itself: its own loop, tools, context and approvals, with the model reached by an API key or account.
_Avoid_: native connection, Moxxy harness

**Agent connection**:
A model connection where a vendor's own coding agent (Claude, Codex, OpenCode) does the work on the user's own subscription, and Moxxy shows the run, answers its approvals and lends it the browser and computer tools.
_Avoid_: SDK connection, harness connection, subscription connection

**Vendor agent**:
The coding agent that does the work in an agent connection, running as the vendor ships it.
_Avoid_: harness (in product copy), external agent

## Asking the user

**Approval**:
A decision the user makes before an action with consequences runs: allow it, allow it for the session, or deny it. Auto-approve answers it for the user.
_Avoid_: permission prompt, confirmation

**Question**:
A request from the agent for the user's choice or answer that blocks no action: a few suggested answers and, when the agent accepts it, an answer of the user's own. Auto-approve never answers it.
_Avoid_: ask, prompt, approval

**Step list**:
The agent's own list of the steps of its task and how far each has got, which it keeps updating while it works.
_Avoid_: todo list, plan (when the agent's list is meant)
