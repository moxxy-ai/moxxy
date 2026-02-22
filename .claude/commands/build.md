Build and verify the entire moxxy project.

## Steps

1. **Build the frontend:**
   ```
   cd frontend && npm run build
   ```
   If `node_modules/` is missing, run `npm ci` first.

2. **Format Rust code:**
   ```
   cargo fmt
   ```

3. **Build the Rust backend** (this also embeds the frontend via `include_dir!`):
   ```
   cargo build --release
   ```

4. **If either build fails**, analyze the error output and fix it:
   - **TOML parse errors**: Check any new `manifest.toml` files in `src/skills/builtins/`
   - **Missing module declarations**: Check `mod.rs` files for missing `pub mod` statements
   - **Unused imports**: Remove them
   - **Type errors in frontend**: Check `frontend/src/types/index.ts`
   - **Missing Node.js**: Frontend requires Node 18+

5. **Run clippy** for lint warnings:
   ```
   cargo clippy --release 2>&1 | head -50
   ```

6. Report the build status (success/failure, any warnings).
