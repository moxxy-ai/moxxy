---
"@moxxy/mode-collaborative": minor
"@moxxy/cli": patch
---

feat(collaborative): brief is a SUMMARY, not the transcript — with on-demand recall

The brief dumped up to ~6KB of the raw conversation into BRIEF.md, and every one
of the N spawned agents was told to read it — so each peer re-ingested the whole
dialogue. Now:

- **BRIEF.md is a concise summary** — the goal + key requirements/constraints/
  decisions — produced by a single coordinator-side LLM call (`summarize.ts`,
  a direct off-log `provider.stream`, mirroring the summarize-compactor) with a
  deterministic **heuristic fallback** when no provider is available, so a brief
  never sinks the run.
- **The full conversation goes to `.moxxy-collab/CONVERSATION.md`** for ON-DEMAND
  recall — never auto-loaded into any agent's context. The prompts tell agents to
  read or grep it only when they need a detail the summary omits.

Net: peers get the intent cheaply instead of paying for the transcript N times.
Adds summarizer (provider/model guard, error/empty → null), brief, and prompt
tests; the e2e run now asserts CONVERSATION.md is written.
