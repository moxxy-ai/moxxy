---
'@moxxy/plugin-provider-local': patch
---

With LM Studio as the local server, Moxxy now uses the context a model is really loaded with (LM Studio 0.4+ `/api/v1/models`), and whether it does tools and images, instead of assuming 8192 tokens. A model loaded with 64k no longer gets its conversation compacted as if it had 8k. A model not loaded yet counts as 4096 until LM Studio loads it, and the next turn reads the real value again.
