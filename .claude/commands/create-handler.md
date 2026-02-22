Create a new web API handler module for the moxxy backend.

Handler request: $ARGUMENTS

## Instructions

### 1. Understand the Request

Parse the handler name and description from the request above. The name should be snake_case (e.g., `analytics`, `notifications`, `logs`).

### 2. Read Reference Materials

Read these files to understand the patterns:

- `src/interfaces/web/handlers/schedules.rs` -- Clean CRUD handler example with all patterns
- `src/interfaces/web/handlers/mod.rs` -- Handler module registration
- `src/interfaces/web/router.rs` -- Route registration
- `src/interfaces/web/mod.rs` -- `AppState` struct (lines 60-70)
- `docs/architecture.md` -- Web API layer architecture

### 3. Create the Handler

Create `src/interfaces/web/handlers/<name>.rs` following this pattern:

```rust
use axum::{
    Json,
    extract::{Path, State},
};

use super::super::AppState;

// Request structs (if needed)
#[derive(serde::Deserialize)]
pub struct CreateSomethingRequest {
    pub field1: String,
    pub field2: Option<String>,
}

// GET handler -- list items
pub async fn get_items_endpoint(
    Path(agent): Path<String>,
    State(state): State<AppState>,
) -> Json<serde_json::Value> {
    let reg = state.registry.lock().await;
    // ... lock registry, get agent's subsystem, fetch data ...

    Json(serde_json::json!({
        "success": true,
        "items": []
    }))
}

// POST handler -- create item
pub async fn create_item_endpoint(
    Path(agent): Path<String>,
    State(state): State<AppState>,
    Json(payload): Json<CreateSomethingRequest>,
) -> Json<serde_json::Value> {
    // Validate input
    if payload.field1.trim().is_empty() {
        return Json(serde_json::json!({
            "success": false,
            "error": "field1 is required"
        }));
    }

    // Get agent's subsystem (clone Arc, drop registry lock)
    let mem_arc = {
        let registry = state.registry.lock().await;
        match registry.get(&agent) {
            Some(mem) => mem.clone(),
            None => {
                return Json(serde_json::json!({
                    "success": false,
                    "error": "Agent not found"
                }));
            }
        }
    };

    // Operate on subsystem
    let mem = mem_arc.lock().await;
    // ... perform operation ...

    Json(serde_json::json!({
        "success": true,
        "message": "Item created"
    }))
}

// DELETE handler
pub async fn delete_item_endpoint(
    Path((agent, item_name)): Path<(String, String)>,
    State(state): State<AppState>,
) -> Json<serde_json::Value> {
    // ... similar pattern ...
    Json(serde_json::json!({ "success": true, "message": "Item deleted" }))
}
```

**Key conventions:**
- Import `AppState` as `super::super::AppState`
- All responses use `Json<serde_json::Value>` with a `"success"` boolean field
- Lock pattern: lock registry -> get agent's Arc -> clone it -> drop registry lock -> lock the Arc
- Validate inputs before operating
- Handle "agent not found" case
- Use `serde_json::json!()` macro for responses
- Function names end with `_endpoint`

### 4. Register the Handler

**a. Add module declaration** in `src/interfaces/web/handlers/mod.rs`:
```rust
pub mod <name>;
```

**b. Add routes** in `src/interfaces/web/router.rs`:

Add the import in the use block:
```rust
use super::handlers::{
    agents, channels, chat, config, mcp, memory, mobile, proxy, schedules, skills, vault, webhooks,
    <name>,  // <-- add here
};
```

Add route definitions in the `Router::new()` chain:
```rust
.route(
    "/api/agents/{agent}/<name>",
    get(<name>::get_items_endpoint).post(<name>::create_item_endpoint),
)
.route(
    "/api/agents/{agent}/<name>/{item_name}",
    axum::routing::delete(<name>::delete_item_endpoint),
)
```

### 5. If Frontend UI is Needed

Suggest using `/create-component` to create a matching React panel, with:
- New type interfaces in `frontend/src/types/index.ts`
- A new `TabId` variant if the handler gets its own dashboard tab
- API calls matching the endpoints you just created

### 6. Format and Build

Run `cargo fmt` to ensure proper formatting, then `cargo build --release` to verify everything compiles. Fix any errors.

### 7. Update API Reference

Add the new endpoints to `docs/api-reference.md` following the existing format.
