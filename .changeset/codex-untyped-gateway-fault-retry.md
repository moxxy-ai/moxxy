---
'@moxxy/plugin-provider-openai-codex': patch
---

Retry the Codex gateway's untyped internal fault instead of killing the turn.

"An error occurred while processing your request ... Please include the request
ID <uuid>" arrives in-band with `code: null` and no `type`, so the code/type
allowlists added for the overload fix matched nothing and the turn ended fatal
after a run's worth of tool calls (seen four times in local session logs). An
unclassified failure is now judged by its message, which in this case literally
says the request can be retried. Any failure that does carry a `code` or `type`
keeps the old verdict, so quota and validation errors stay fatal.
