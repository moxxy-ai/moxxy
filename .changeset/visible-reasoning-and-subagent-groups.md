---
'@moxxy/sdk': minor
'@moxxy/chat-model': minor
'@moxxy/client-core': minor
'@moxxy/config': minor
'@moxxy/cli': minor
'@moxxy/desktop': minor
'@moxxy/core': patch
'@moxxy/plugin-subagents': patch
'@moxxy/plugin-provider-anthropic': patch
'@moxxy/plugin-provider-openai': patch
'@moxxy/plugin-provider-openai-codex': patch
---

Make the model's reasoning visible, and redesign sub-agents as a collapsible group.

**Reasoning preview (per-provider, Codex-style between calls).** When enabled, the model's
thinking now streams live (replacing the silent "thinking…" dots) and is kept as a dim,
collapsible "Thinking" block interleaved with the tool calls it precedes — so you can see what
the model is doing instead of waiting out a multi-second pause. Because reasoning is finalized
once per provider round, summaries land naturally between tool batches.

It's gated per provider/model via a new `ModelDescriptor.supportsReasoning` capability and turned
on with `config.context.reasoning` (`true`, or `{ effort: 'low' | 'medium' | 'high' }`):

- **Anthropic / Claude Code** — adaptive thinking with summarized display; the signed thinking
  block round-trips so interleaved-thinking tool-use continuations stay valid.
- **OpenAI Codex** — surfaces the reasoning summary it already requests (previously discarded).
- **OpenAI** — `reasoning_effort` for the gpt-5 family plus the `reasoning_content` summary that
  OpenAI-compatible reasoning backends stream.

New SDK surface: a `reasoning` `ContentBlock`, `reasoning_delta`/`reasoning_signature`
`ProviderEvent`s, `reasoning_chunk`/`reasoning_message` events, a `ProviderRequest.reasoning`
knob, and `ModelDescriptor.supportsReasoning`. No runner protocol bump — reasoning events ride
the existing event channel.

**Grouped sub-agents view.** A `dispatch_agent` fan-out now renders as one collapsible group —
a header (`N Explore agents finished`) over a tree of per-agent rows showing each agent's tool-use
count, **token usage**, and status — instead of one block per child. Per-agent token totals and the
agent kind are forwarded on the `subagent_*` events; both the desktop and TUI render the new tree.
