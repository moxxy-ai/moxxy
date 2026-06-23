---
"@moxxy/sdk": minor
"@moxxy/plugin-workflows": minor
---

Add an `echo` workflow step — deterministic output with no agent turn.

`echo` renders a template (`{{ steps.<id>.output }}`, `{{ vars.* }}`,
`{{ inputs.* }}`, `{{ now }}`) and uses it verbatim as the step's output, without
spawning a child agent. Use it for pure formatting/delivery steps (e.g. emit an
already-written digest) where a `prompt` step would burn a model call and could
re-interpret or loop on the content. The workflow drafter now prefers `echo` over
a `prompt` for pass-through/delivery steps.
