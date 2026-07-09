---
'@moxxy/plugin-provider-openai-codex': minor
'@moxxy/cli': minor
'@moxxy/sdk': minor
---

`moxxy init`: let OAuth providers with a device-code flow (openai-codex) offer a browser vs. no-browser choice during the wizard, so a headless/remote box can sign in by pasting a URL + code instead of relying on a loopback browser that can't open. Providers advertise the capability via `ProviderAuthDescriptor.supportsHeadless`; `ProviderSetupView.loginOAuth` now accepts an optional `{ headless }`.
