# @moxxy/plugin-channel-whatsapp

## 0.37.0

### Patch Changes

- Updated dependencies [78938f8]
  - @moxxy/sdk@0.37.0
  - @moxxy/channel-kit@0.37.0
  - @moxxy/core@0.37.0
  - @moxxy/plugin-vault@0.37.0

## 0.36.1

### Patch Changes

- @moxxy/sdk@0.36.1
- @moxxy/core@0.36.1
- @moxxy/channel-kit@0.36.1
- @moxxy/plugin-vault@0.36.1

## 0.36.0

### Patch Changes

- Updated dependencies [bc7844e]
  - @moxxy/sdk@0.36.0
  - @moxxy/channel-kit@0.36.0
  - @moxxy/core@0.36.0
  - @moxxy/plugin-vault@0.36.0

## 0.35.4

### Patch Changes

- @moxxy/sdk@0.35.4
- @moxxy/core@0.35.4
- @moxxy/channel-kit@0.35.4
- @moxxy/plugin-vault@0.35.4

## 0.35.3

### Patch Changes

- @moxxy/sdk@0.35.3
- @moxxy/core@0.35.3
- @moxxy/channel-kit@0.35.3
- @moxxy/plugin-vault@0.35.3

## 0.35.2

### Patch Changes

- @moxxy/sdk@0.35.2
- @moxxy/core@0.35.2
- @moxxy/channel-kit@0.35.2
- @moxxy/plugin-vault@0.35.2

## 0.35.1

### Patch Changes

- @moxxy/sdk@0.35.1
- @moxxy/core@0.35.1
- @moxxy/channel-kit@0.35.1
- @moxxy/plugin-vault@0.35.1

## 0.35.0

### Patch Changes

- Updated dependencies [57f0810]
  - @moxxy/sdk@0.35.0
  - @moxxy/channel-kit@0.35.0
  - @moxxy/core@0.35.0
  - @moxxy/plugin-vault@0.35.0

## 0.34.0

### Patch Changes

- Updated dependencies [ae16897]
- Updated dependencies [d9ae119]
- Updated dependencies [6d8fdcd]
- Updated dependencies [220673e]
- Updated dependencies [b25850c]
- Updated dependencies [63b1df5]
- Updated dependencies [3dfc2f3]
- Updated dependencies [e52e2ed]
- Updated dependencies [e52e2ed]
- Updated dependencies [06e81f8]
  - @moxxy/core@0.34.0
  - @moxxy/sdk@0.34.0
  - @moxxy/channel-kit@0.34.0
  - @moxxy/plugin-vault@0.34.0

## 0.33.0

### Patch Changes

- Updated dependencies [b241085]
  - @moxxy/sdk@0.33.0
  - @moxxy/channel-kit@0.33.0
  - @moxxy/core@0.33.0
  - @moxxy/plugin-vault@0.33.0

## 0.32.0

### Patch Changes

- Updated dependencies [3b0c14a]
  - @moxxy/sdk@0.32.0
  - @moxxy/channel-kit@0.32.0
  - @moxxy/core@0.32.0
  - @moxxy/plugin-vault@0.32.0

## 0.31.0

### Patch Changes

- Updated dependencies [8bb26b1]
- Updated dependencies [43926ab]
  - @moxxy/sdk@0.31.0
  - @moxxy/channel-kit@0.31.0
  - @moxxy/core@0.31.0
  - @moxxy/plugin-vault@0.31.0

## 0.30.0

### Patch Changes

- Updated dependencies [c124a15]
  - @moxxy/sdk@0.30.0
  - @moxxy/channel-kit@0.30.0
  - @moxxy/core@0.30.0
  - @moxxy/plugin-vault@0.30.0

## 0.29.0

### Patch Changes

- 8ef529a: Replace non-null assertions (`x!`) and deep optional chains (`a?.b?.c`) in the
  channel plugins with guard clauses. Source sites that are impossible-by-construction
  now assert loudly via `assertDefined`/`invariant` from `@moxxy/sdk` instead of
  silently propagating `undefined`; inbound-message silent-drop gates are preserved
  exactly. No behavior change on the success path.
- Updated dependencies [d99087f]
- Updated dependencies [f360bf6]
  - @moxxy/sdk@0.29.0
  - @moxxy/channel-kit@0.29.0
  - @moxxy/core@0.29.0
  - @moxxy/plugin-vault@0.29.0

## 0.28.1

### Patch Changes

- Updated dependencies [6c0af71]
  - @moxxy/sdk@0.28.1
  - @moxxy/channel-kit@0.28.1
  - @moxxy/core@0.28.1
  - @moxxy/plugin-vault@0.28.1

## 0.28.0

### Patch Changes

- Updated dependencies [3e4b2b4]
- Updated dependencies [e4e2941]
  - @moxxy/sdk@0.28.0
  - @moxxy/channel-kit@0.28.0
  - @moxxy/core@0.28.0
  - @moxxy/plugin-vault@0.28.0

## 0.27.0

### Minor Changes

- be28d55: Add a WhatsApp channel via Baileys (`@moxxy/plugin-channel-whatsapp`): QR device-link pairing, a mandatory typed consent gate for the unofficial-API/ban risk, JID allow-list (owner Note-to-Self allowed by default), fromMe-echo loop protection, voice-note transcription, and send-then-edit streaming over a swappable auth-state backend. Runs on its own dedicated isolated runner (`sessionSource: 'whatsapp'`, added to the SDK `SessionSource` union).

### Patch Changes

- 3b27404: `moxxy onboard` — one guided command from a fresh install to a paired, always-on agent: provider wizard (skipped when configured) → messenger pick from the install catalog → version-pinned install + `moxxy.setup` fields → the channel's own pairing in a new pair-then-return mode (`EXIT_AFTER_PAIR_FLAG` in the SDK, honored by all five pair flows) → a `moxxy serve --all` background unit. Also: channel install hints are now derived from catalog `provides` (telegram/slack/web/http entries gained theirs), Telegram + Slack declare `moxxy.setup` token steps, the `service` catalog's serve unit actually starts channels (`--all`, matching its description), and service units survive Electron-as-node installs (`ELECTRON_RUN_AS_NODE=1` exported into the unit).
- Updated dependencies [87aac6d]
- Updated dependencies [03e5f87]
- Updated dependencies [5d6677d]
- Updated dependencies [81e6b68]
- Updated dependencies [e791484]
- Updated dependencies [49b1d73]
- Updated dependencies [6460cc6]
- Updated dependencies [3b27404]
- Updated dependencies [0b6f40e]
- Updated dependencies [2cff46b]
- Updated dependencies [2cef8e1]
- Updated dependencies [98f545c]
- Updated dependencies [ee2967d]
- Updated dependencies [2a35357]
- Updated dependencies [67a3387]
- Updated dependencies [b2a5fba]
- Updated dependencies [be28d55]
  - @moxxy/core@0.27.0
  - @moxxy/plugin-vault@0.27.0
  - @moxxy/channel-kit@0.27.0
  - @moxxy/sdk@0.27.0
