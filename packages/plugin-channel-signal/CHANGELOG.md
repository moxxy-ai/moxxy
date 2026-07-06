# @moxxy/plugin-channel-signal

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
