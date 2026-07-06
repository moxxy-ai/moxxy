# @moxxy/plugin-channel-imessage

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
