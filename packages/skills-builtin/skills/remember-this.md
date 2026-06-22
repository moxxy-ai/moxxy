---
name: remember-this
description: Save a fact, preference, project note, or reference to long-term memory for future sessions.
triggers: ["remember", "save this", "for later", "memorize", "note that"]
allowed-tools: [memory_save, memory_list, memory_recall, memory_update]
---
# Remember this

The user wants you to commit something to long-term memory so it's available in future sessions.

## Decide the type

- **fact**: a static piece of knowledge ("the API endpoint is X")
- **preference**: how the user wants you to work ("they prefer terse responses")
- **project**: context about the project they're working on
- **reference**: a pointer to external info ("docs live at confluence.example.com")

## Workflow

1. **Distill** what the user just said into 1–2 sentences. If the original was a long ramble, summarize. If it was already terse, keep it.
2. **Check existing memories** with `memory_recall(query)` for similar entries. If a related entry exists, prefer `memory_update` over creating a new one — don't fragment.
3. **Save** with `memory_save({ name, type, description, body, tags })`:
   - `name`: slug, kebab-case — aim for ≤60 chars (`memory_save` hard cap 120)
   - `description`: one sentence — aim for ≤120 chars (hard cap 280); this is what shows in the index
   - `body`: keep it tight (~≤30 lines); the actual content
   - `tags`: optional, lowercase keywords for cross-cutting topics

4. **Confirm** briefly: "Saved as `<name>`."

## Don't

- Don't save secrets here — use the vault.
- Don't save ephemeral state (open files, current cursor position, etc.). Memories should be useful in any future session.
- Don't create overlapping entries. If unsure, recall first.
