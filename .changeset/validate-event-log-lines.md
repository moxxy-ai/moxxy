---
'@moxxy/cli': patch
---

Validate event-log lines on read instead of casting: session JSONL reads (restore, history paging, index hydration) now pass every parsed line through a shallow structural guard (`isMoxxyEventShape`) and skip wrong-shape lines with the same never-throw semantics as corrupt JSON, instead of trusting them as `MoxxyEvent`s that could crash replay (e.g. a compaction line missing `replacedRange` threw mid-projection).
