# @moxxy/plugin-channel-imessage

## 0.38.0

### Patch Changes

- Updated dependencies [971fd32]
  - @moxxy/sdk@0.38.0
  - @moxxy/channel-kit@0.38.0
  - @moxxy/core@0.38.0
  - @moxxy/plugin-vault@0.38.0

## 0.37.2

### Patch Changes

- Updated dependencies [84dd2c5]
  - @moxxy/sdk@0.37.2
  - @moxxy/channel-kit@0.37.2
  - @moxxy/core@0.37.2
  - @moxxy/plugin-vault@0.37.2

## 0.37.1

### Patch Changes

- Updated dependencies [e80b9d6]
- Updated dependencies [abd9482]
- Updated dependencies [5e4ca9f]
  - @moxxy/sdk@0.37.1
  - @moxxy/channel-kit@0.37.1
  - @moxxy/core@0.37.1
  - @moxxy/plugin-vault@0.37.1

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

### Minor Changes

- d99087f: New iMessage channel (`moxxy imessage`): drive moxxy from iMessage via a
  localhost BlueBubbles server (macOS only). v1 sends text with the stock
  apple-script method and receives via the BlueBubbles socket.io `new-message`
  feed; 1:1 text chats only. Trust is a vault-stored server URL + password plus a
  JSON handle allow-list, with your own self-chat allowed via a separate owner-handle
  list; unknown senders are dropped silently and the channel's own echoes are
  filtered. Runs on a dedicated isolated runner with `sessionSource: 'imessage'`.
  Subcommands: `setup` (interactive wizard), `status`, `unpair`. Wires
  `'imessage'` into SDK `SESSION_SOURCES`, the plugins-admin install catalog, and
  the desktop channel catalog.

### Patch Changes

- Updated dependencies [d99087f]
- Updated dependencies [f360bf6]
  - @moxxy/sdk@0.29.0
  - @moxxy/channel-kit@0.29.0
  - @moxxy/core@0.29.0
  - @moxxy/plugin-vault@0.29.0
