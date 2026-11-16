---
'@moxxy/cli': patch
'@moxxy/core': patch
'@moxxy/sdk': patch
---

Opening a conversation reads only its own history instead of every saved conversation, avoiding memory exhaustion and repeated reconnects for large session libraries. Session readers process JSONL incrementally so files over Node's whole-string limit (about 512 MiB) remain readable. Repairs retain atomic replacement and write event-sized chunks through the atomic writer, which now accepts iterables. Conversation content, metadata selection and history paging remain unchanged.
