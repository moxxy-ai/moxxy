# moxxy-test-utils

Shared testing utilities for the Moxxy workspace.

## Overview

Provides `TestDb`, an in-memory SQLite database with automatic schema initialization for integration testing across all crates.

## TestDb

```rust
use moxxy_test_utils::TestDb;

// Fresh database with full schema
let db = TestDb::new();
let dao = TokenDao { conn: db.conn() };

// With custom seed data
let db = TestDb::with_seed(|conn| {
    conn.execute("INSERT INTO agents ...", []).unwrap();
});

// Transfer ownership of the connection
let conn = db.into_conn();
```

On construction, `TestDb`:
1. Opens an in-memory SQLite connection
2. Loads the `sqlite-vec` extension for vector operations
3. Runs all migrations from `migrations/0001_init.sql`
4. Creates the `memory_vec0` virtual table for embeddings

## Methods

| Method | Description |
|---|---|
| `new()` | Fresh database with full schema |
| `with_seed(fn)` | Database + custom seed function on connection |
| `conn()` | Borrow the underlying `rusqlite::Connection` |
| `into_conn()` | Consume and take ownership of the connection |

## Used By

All crates with database-dependent tests: `moxxy-storage`, `moxxy-core`, `moxxy-vault`, `moxxy-channel`, `moxxy-runtime`, `moxxy-gateway`.

## Dependencies

- `rusqlite` -- SQLite driver
- `sqlite-vec` -- vector extension
- `moxxy-storage` -- `Database` wrapper type
