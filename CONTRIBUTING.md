# Contributing to Moxxy

Thanks for your interest in contributing to Moxxy. This guide covers everything you need to get a development environment running and submit quality contributions.

## Development Setup

### Prerequisites

- **Rust** 1.80+ (edition 2024) = install via [rustup.rs](https://rustup.rs)
- **Node.js** 22+ = install via [nodejs.org](https://nodejs.org) or your preferred version manager

### Clone and build

```bash
git clone https://github.com/moxxy-ai/moxxy.git
cd moxxy

# Build the full Rust workspace (9 crates)
cargo build --workspace

# Install CLI dependencies
cd apps/moxxy-cli
npm install
cd ../..
```

### Run the test suite

```bash
# All Rust tests (448 tests across 9 crates)
cargo test --workspace

# CLI tests (58 tests)
cd apps/moxxy-cli && npm test

# Verbose output
cargo test --workspace -- --nocapture

# Single crate
cargo test -p moxxy-core

# Single test
cargo test -p moxxy-core -- auth::token::tests::issued_token_has_mox_prefix
```

### Lint and format

```bash
cargo clippy --workspace -- -D warnings
cargo fmt --all --check
```

## Test Coverage

| Crate | Tests | Focus |
|---|---:|---|
| `moxxy-types` | 15 | Type validation, error variants |
| `moxxy-test-utils` | 4 | TestDb, fixture factories |
| `moxxy-storage` | 68 | DAO CRUD, migrations, row types |
| `moxxy-core` | 56 | Auth, events, heartbeat, skills, security |
| `moxxy-vault` | 10 | Secret backend, grants |
| `moxxy-channel` | 12 | Telegram, Discord, pairing, bridge |
| `moxxy-gateway` | 41 + 15 e2e | Routes, middleware, SSE |
| `moxxy-runtime` | 136 | 34 primitives, providers, agent loop |
| `moxxy-plugin` | 26 | WASI plugin system |
| `moxxy-cli` | 58 | Commands, API client, SSE, TUI |
| **Total** | **506** | |

## TDD Workflow

This project follows strict Test-Driven Development. When adding new functionality:

1. **RED** = Write failing tests first. They must compile but fail.
2. **GREEN** = Write the minimum code to make every test pass.
3. **REFACTOR** = Improve structure while keeping all tests green.

Every PR should include tests for any new behavior.

## Project Structure

```
moxxy/
├── Cargo.toml                 # Virtual workspace manifest
├── rust-toolchain.toml        # Rust edition 2024, stable channel
├── migrations/                # SQLite migrations (9 files)
├── openapi/openapi.yaml       # OpenAPI 3.1.0 contract
├── examples/skills/           # Example skill definitions
├── crates/
│   ├── moxxy-types/           # Shared types, enums, errors
│   ├── moxxy-test-utils/      # TestDb (in-memory SQLite), fixtures
│   ├── moxxy-storage/         # 15 DAOs, row types, Database wrapper
│   ├── moxxy-core/            # Domain logic (auth, agents, events, heartbeat, skills, security, memory)
│   ├── moxxy-vault/           # SecretBackend trait, keychain, grants
│   ├── moxxy-channel/         # Telegram, Discord, bridge, pairing
│   ├── moxxy-gateway/         # Axum REST + SSE, middleware, audit
│   ├── moxxy-runtime/         # 34 primitives, provider trait, agentic loop
│   └── moxxy-plugin/          # WASI plugin host
└── apps/moxxy-cli/            # Node.js CLI
    ├── src/
    │   ├── tui/               # Full-screen TUI (pi-tui)
    │   ├── commands/          # Command handlers with wizards
    │   └── api-client.js      # Gateway HTTP client
    └── test/                  # CLI tests (node:test)
```

## Commit Convention

Commits follow [Conventional Commits](https://www.conventionalcommits.org/):

| Prefix | Use |
|---|---|
| `feat:` | New feature |
| `fix:` | Bug fix |
| `refactor:` | Code restructuring (no behavior change) |
| `test:` | Adding or updating tests |
| `docs:` | Documentation changes |
| `chore:` | Build, CI, tooling changes |

## Before Submitting a PR

Run the full quality gate:

```bash
cargo test --workspace                    # All Rust tests pass
cargo clippy --workspace -- -D warnings   # Zero clippy warnings
cargo fmt --all --check                   # Code is formatted
cd apps/moxxy-cli && npm test             # CLI tests pass
```

## Key Conventions

- **Row types** are defined in `moxxy-storage/src/rows.rs`
- **Test fixtures** live in `moxxy-storage/src/fixtures.rs` (behind `cfg(test)`)
- **TestDb** provides an in-memory SQLite database with all migrations applied = use `TestDb::new()` and `into_conn()` in tests
- **Primitives** implement the `Primitive` trait with `description()` and `parameters_schema()` methods
- **Gateway state** uses `Arc<Mutex<Database>>` for thread-safe SQLite access
- **Auth tokens** are SHA-256 hashed with a `mox_` prefix = plaintext is never stored

## License

By contributing, you agree that your contributions will be dual-licensed under the [MIT](LICENSE-MIT) and [Apache 2.0](LICENSE-APACHE) licenses.
