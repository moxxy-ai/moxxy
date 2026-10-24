---
'@moxxy/cli': patch
---

Research mode reads its searches only from the plan's `QUERIES:` list, so a planner that answered the question directly no longer turns lines of its answer into searches. Such a planner is asked once more for a plan, and if it answers again the question itself is researched. The planner no longer gets the skill list, which told it to call `load_skill` though it can call no tool.
