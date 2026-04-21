---
name: moxxy-new-primitive
description: Use when the user wants to add a new runtime primitive to crates/moxxy-runtime (e.g. "add a slack.post primitive", "create a new primitive for X", "I need a primitive that does Y"). Owns the full scaffolding workflow — trait impl, mod.rs registration, registry wiring, tests.
---

# Add a New Moxxy Primitive

A primitive is a tool an agent can invoke. Adding one is a multi-file change that touches the trait impl, module registration, runtime bootstrap, and tests.

## How to invoke

Delegate the implementation to the `moxxy-primitive-author` agent:

```
Agent({
  subagent_type: "moxxy-primitive-author",
  description: "Scaffold <namespace>.<action> primitive",
  prompt: "Add a new primitive `<namespace>.<action>` that <what it does>.

Inputs: <list fields and types>.
Output shape: <what the JSON result looks like>.
Side effects: <fs? network? db? none>.
Read-only (concurrent-safe): <yes/no>.
Allowlist defaults: <should it be on by default? which agent kinds?>

Follow the Moxxy primitive conventions: implement the `Primitive` trait, wire re-exports in `crates/moxxy-runtime/src/primitives/mod.rs`, register in the runtime bootstrap (grep for an analogue), add `#[cfg(test)] mod tests` with happy path + InvalidParams case.

Run `cargo check -p moxxy-runtime` and `cargo test -p moxxy-runtime` before reporting back."
})
```

## Before delegating — gather these from the user

Ask only what's missing. Don't re-ask things already in the user's request.

1. **Namespace + action** — e.g. `slack.post`, `math.eval`. Must not collide with existing primitives (check `crates/moxxy-runtime/src/primitives/mod.rs`).
2. **Purpose** — one sentence. Will feed the `description()` impl.
3. **Inputs** — field names + JSON types. Required vs optional.
4. **Side effects** — filesystem, network, database, vault secrets. This determines which safety layers apply.
5. **Concurrency** — read-only primitives return `is_concurrent_safe() -> true`.

If the primitive needs a schema migration (new DAO), also route through `moxxy-storage-author` first — mention this to the user so they're not surprised by the cross-crate churn.

## After the agent returns

1. Read the diff to confirm: new module exists, `mod.rs` has both `pub mod` and `pub use`, registration call exists, tests are present and passing.
2. If everything is green, offer to run the full gate via the `moxxy-qa` skill before the user commits.
3. Remind the user: for the primitive to be usable by an existing agent, its name must appear in that agent's skill `allowed_primitives` list. Skills are installed via `moxxy skill create --agent <id>`.

## When NOT to use this skill

- Modifying an existing primitive's behavior → use the `moxxy-primitive-author` agent directly with a narrower prompt.
- Adding a *Moxxy agent skill* (the YAML-frontmatter Markdown document) — that's the `moxxy-skill-creator` skill, not this one. A primitive is Rust code; a skill is a policy document over primitives.
