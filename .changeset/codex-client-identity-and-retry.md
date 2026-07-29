---
'@moxxy/plugin-provider-openai-codex': patch
---

Fix Codex turns dying on "Our servers are currently overloaded".

The ChatGPT Codex backend gates on `originator` together with `User-Agent`.
Identifying as `moxxy` got throttled with in-band `server_is_overloaded` and
`server_error` failures: measured on one account with identical payloads sent
back to back, the official pair succeeded 6/6 where `moxxy` managed 2/6, and a
25-request sample failed 23 times. Both headers now name the official CLI;
matching only one of the two is not enough.

Transient in-band failures are also retryable now. The backend reports capacity
and internal faults inside a 200 SSE stream, so they never reached the HTTP
status classifier and a blip ended the turn with no retry. Quota and validation
failures stay fatal. Also fixes the failure message being dropped on a
`response.failed` frame, which nests its error under `response.error` rather
than the sibling `error` field the handler was reading.
