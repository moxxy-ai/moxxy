# Provider Guide

Providers are the LLM backends that agents use to generate responses and tool calls. Moxxy supports both built-in providers and custom provider plugins.

## The Provider Trait

Every provider implements the `Provider` trait:

```rust
#[async_trait]
pub trait Provider: Send + Sync {
    async fn complete(
        &self,
        messages: Vec<Message>,
        config: &ModelConfig,
        tools: &[ToolDefinition],
    ) -> Result<ProviderResponse, PrimitiveError>;

    async fn complete_stream(
        &self,
        messages: Vec<Message>,
        config: &ModelConfig,
        tools: &[ToolDefinition],
    ) -> Result<Pin<Box<dyn Stream<Item = StreamEvent> + Send>>, PrimitiveError>;
}
```

### Message

```rust
pub struct Message {
    pub role: String,         // "user", "assistant", "system", "tool"
    pub content: String,
    pub tool_calls: Option<Vec<ToolCall>>,  // For assistant messages with tool calls
    pub tool_call_id: Option<String>,       // For tool result messages
    pub name: Option<String>,              // Tool name for tool results
}
```

Constructors: `Message::system()`, `Message::user()`, `Message::assistant()`, `Message::assistant_with_tool_calls()`, `Message::tool_result()`.

### ModelConfig

```rust
pub struct ModelConfig {
    pub temperature: f64,
    pub max_tokens: u32,
    pub tool_choice: ToolChoice,  // Auto or Any
}
```

### ProviderResponse

```rust
pub struct ProviderResponse {
    pub content: String,
    pub tool_calls: Vec<ToolCall>,
    pub usage: Option<TokenUsage>,
}

pub struct ToolCall {
    pub id: String,                 // Unique call ID for round-tripping
    pub name: String,               // e.g., "fs.read"
    pub arguments: serde_json::Value, // e.g., {"path": "src/main.rs"}
}
```

The `complete()` method sends messages and tool schemas to the LLM and returns the response. If the LLM wants to invoke tools, it returns `ToolCall` entries that the runtime executes as primitives. The `complete_stream()` method provides streaming via `StreamEvent`.

## Built-in Providers

### EchoProvider

A testing provider that echoes the last user message:

```rust
let provider = EchoProvider::new();
```

Useful for testing the run execution pipeline without needing an actual LLM API.

### OpenAIProvider

An OpenAI-compatible provider that works with any endpoint following the OpenAI chat completions API:

```rust
let provider = OpenAIProvider::new(
    "https://api.openai.com/v1",
    "sk-abc123",
    "gpt-4.1",
);
```

Compatible with:
- OpenAI API
- Anthropic API (via proxy)
- Ollama (local models)
- Any OpenAI-compatible endpoint

## Creating a Custom Provider

### Step 1: Implement the Provider trait

```rust
use async_trait::async_trait;
use moxxy_runtime::{Provider, Message, ModelConfig, ProviderResponse, PrimitiveError, ToolDefinition};

pub struct MyProvider {
    api_key: String,
    model_id: String,
}

#[async_trait]
impl Provider for MyProvider {
    async fn complete(
        &self,
        messages: Vec<Message>,
        config: &ModelConfig,
        tools: &[ToolDefinition],
    ) -> Result<ProviderResponse, PrimitiveError> {
        // Call your LLM API here
        // Send tool schemas from `tools` so the LLM knows which tools are available
        // Parse the response
        // Return ProviderResponse with content and tool_calls
        todo!()
    }
}
```

### Step 2: Register the provider

Providers are registered with the gateway's `AppState`:

```rust
let provider = Arc::new(MyProvider {
    api_key: "sk-...".into(),
    model_id: "my-model".into(),
});
state.register_provider("my-provider".into(), provider);
```

### Step 3: Install via API

```bash
curl -X POST http://localhost:3000/v1/providers \
  -H "Authorization: Bearer $MOXXY_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "id": "my-provider",
    "display_name": "My Provider",
    "models": [
      {"model_id": "my-model", "display_name": "My Model v1"}
    ]
  }'
```

### Step 4: Create an agent using the provider

```bash
moxxy agent create --provider my-provider --model my-model --workspace ~/project
```

## Plugin Manifest

For WASI-based providers, create a YAML manifest:

```yaml
provider_id: my-wasi-provider
wasm_path: /path/to/provider.wasm
sig_path: /path/to/provider.sig    # Optional Ed25519 signature
allowed_domains:
  - api.my-llm.com
fuel_limit: 1000000000             # Default: 1 billion
memory_limit_bytes: 268435456      # Default: 256 MB
```

See [WASI Providers](wasi-provider.md) for details on building WASM-based providers.
