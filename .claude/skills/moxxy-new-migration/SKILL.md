---
name: moxxy-new-migration
description: Use when the user wants to add or modify a database schema — new table, new column, new index, or a data backfill. Covers migration file, row types, DAO, fixtures, and TestDb wiring. Triggers: "add a migration", "new table for X", "alter the Y table", "add a column to Z".
---

# Add a Moxxy SQL Migration

Migrations live in `migrations/NNNN_<name>.sql` at the repo root (zero-padded 4-digit number). They ripple through `crates/moxxy-storage` row types, DAO, and fixtures, and are applied by `TestDb` in tests.

## How to invoke

Delegate to the `moxxy-storage-author` agent:

```
Agent({
  subagent_type: "moxxy-storage-author",
  description: "Add migration <name>",
  prompt: "Add a new migration: <describe the schema change — new table with columns X/Y/Z, or ALTER TABLE foo ADD COLUMN bar TEXT NOT NULL DEFAULT '', etc.>.

Check `ls migrations/` first to pick the next zero-padded number. Create the SQL migration, update/add the row struct in `rows.rs`, update/create the DAO under `dao/`, register it in `dao/mod.rs` and on `Database` in `lib.rs`, add a fixture in `fixtures.rs`, and write `#[cfg(test)] mod tests` using TestDb.

For an ALTER: grep `rg <DaoName>` across the workspace to find every caller that needs updating, and list them for me in your report.

Run `cargo test -p moxxy-storage` + `cargo test -p moxxy-test-utils`. Don't call it done until both pass."
})
```

## Before delegating — gather from the user

1. **What changes** — new table? column? index? data backfill?
2. **Column types** — SQLite affinities (`INTEGER`, `TEXT`, `REAL`, `BLOB`). For timestamps: confirm ms vs seconds by checking a neighboring table.
3. **Constraints** — NOT NULL? UNIQUE? FOREIGN KEY? CHECK? Default values?
4. **Backwards compatibility** — if adding NOT NULL to an existing table, what's the backfill value? If it's a user-provided value there's no sensible backfill — push back and propose nullable-then-tighten instead.
5. **Index needs** — any column used as a lookup key usually wants an index.

## Hazards to flag up-front

- **Never edit an applied migration.** If the user asks to "fix migration 0001", stop — explain that applied migrations are immutable and propose a new migration instead.
- **Rename-a-column in SQLite** requires `ALTER TABLE ... RENAME COLUMN` (supported in modern SQLite, fine with the workspace's `rusqlite` bundled build) — confirm before assuming.
- **Dropping a column** older SQLite didn't support natively, but modern does — still, prefer nullable + stop writing over drop when the table is load-bearing.
- **Schema changes ripple into the gateway openapi** (`openapi/openapi.yaml`) if the shape is exposed in REST responses. The agent won't update that automatically — call it out for follow-up.

## After the agent returns

1. Confirm the migration file number is the next in sequence.
2. Confirm the DAO + row + fixture are all present.
3. Run `moxxy-qa` skill — schema changes are the most common source of cross-crate test breakage.
4. If the schema is exposed via the REST API, remind the user to update `openapi/openapi.yaml` manually (that's a hand-maintained contract doc).
