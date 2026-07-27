---
'@moxxy/cli': minor
'@moxxy/core': minor
'@moxxy/sdk': minor
---

Add `moxxy receipt <turnId>`: a verified account of one run assembled from the audit trail.

The trail already recorded what happened, but answering "who ran this, what set it off, which rules were in force, and what did it cost" meant reading raw JSONL. A receipt is a projection over those records, so asking for one writes nothing.

Two records were missing for this to be answerable, and both are now emitted when `audit.enabled` is set: a `policy` record at session start carrying a fingerprint over the settings that decide what the agent may do (counts and effective values only, no secrets or paths), and a `usage` record per provider response carrying token counts. The request and the reply stay in the event log where they belong.

The enclosing chain is verified before a receipt prints. A broken chain marks the receipt and exits 1, so a receipt from a trail with a deleted record cannot look complete.
