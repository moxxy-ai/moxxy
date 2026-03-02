# Installation

## Prerequisites

| Dependency | Minimum Version | Purpose |
|------------|----------------|---------|
| **Rust** | 1.80+ (stable) | Build the Rust workspace (9 crates) |
| **Node.js** | 22+ | Run the CLI and TUI |
| **SQLite** | 3.35+ | Bundled via `rusqlite`, no system install needed |

The project uses Rust edition 2024 (configured in `rust-toolchain.toml`).

## Quick Install (curl)

The fastest path from zero to running:

```bash
curl -fsSL https://moxxy.ai/install.sh | sh
```

This downloads the correct pre-built gateway binary for your platform and installs the CLI globally.

## Build from Source

### 1. Clone the repository

```bash
git clone https://github.com/moxxy-ai/moxxy-v4.git
cd moxxy-v4
```

### 2. Build all Rust crates

```bash
cargo build --workspace --release
```

This compiles all 9 crates including the gateway binary. The first build takes a few minutes due to dependency compilation; subsequent builds are incremental.

### 3. Install the CLI

```bash
cd apps/moxxy-cli
npm install
npm link
```

The `npm link` command makes the `moxxy` command available globally in your PATH.

### 4. Verify the installation

```bash
# Check all components
moxxy doctor

# Run the test suite
cargo test --workspace           # Rust tests
cd apps/moxxy-cli && npm test    # CLI tests

# Check code quality
cargo clippy --workspace -- -D warnings
cargo fmt --all --check
```

## Building Release Binaries

To build platform-specific gateway binaries for distribution:

```bash
# Build for current platform
./scripts/build-gateway.sh dist

# Build all targets (macOS + Linux, arm64 + x86_64)
./scripts/build-gateway.sh dist --all

# Build specific targets
./scripts/build-gateway.sh dist darwin-arm64 linux-x86_64
```

Output:

```
dist/
├── moxxy-gateway-darwin-arm64
├── moxxy-gateway-darwin-x86_64
├── moxxy-gateway-linux-arm64
├── moxxy-gateway-linux-x86_64
└── checksums.sha256
```

## Data Directory

Moxxy stores all local data under `~/.moxxy/` by default (configurable via `MOXXY_HOME`):

```
~/.moxxy/
├── moxxy.db                # SQLite database (WAL mode)
├── config/                 # Configuration files
└── agents/
    └── {agent-id}/
        ├── workspace/      # Agent working directory
        └── memory/         # Agent memory journal
```

## Troubleshooting

**Rust version too old**: Ensure you have Rust 1.80+ installed. Run `rustup update stable`.

**Node.js version too old**: Moxxy CLI requires Node.js 22+ for the built-in test runner and ESM module support. Check with `node --version`.

**SQLite errors**: The `rusqlite` dependency bundles SQLite with the `bundled` feature, so you should not need a system SQLite installation. If you see linking errors, ensure your C compiler toolchain is installed (`xcode-select --install` on macOS, `build-essential` on Debian/Ubuntu).

**Permission denied on `npm link`**: On Linux/macOS, you may need to configure npm's global prefix to a user-writable directory, or use `sudo npm link`.
