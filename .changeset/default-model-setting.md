---
'@moxxy/cli': minor
'@moxxy/desktop': minor
---

Settings → Providers has a **Default model**: the model, reasoning effort and fast tier a new conversation starts with. It is written to the config (`plugins.provider.default`, `plugins.provider.items.<provider>.model`, `context.reasoning`, `context.fast`), so the desktop, the terminal and the channels all start the same way; before, a conversation that named no model ran on the first one its provider lists, whatever the config said. The model control in the chat header now names the model a turn will run on instead of the provider. An effort or fast switch made in a conversation stays with its workspace and no longer carries over to every other one.
