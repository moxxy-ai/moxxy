# @moxxy/desktop-ui

## 0.2.0

### Minor Changes

- 34cca59: Chat: a user turn now reads left-to-right like every other block, with an
  avatar, a "You" label and an accent left rule instead of right-aligned text.
  Right alignment only said whose turn it was while the turn was short: a pasted
  prompt wrapped into a ragged-left column the eye had to re-find on every line.

  Tray: the macOS menu bar gets the one-colour mark as a template image at 22px
  and @2x, so AppKit tints it for the light and dark bar and for the menu-open
  state. Windows and Linux keep the colour icon, since their tray chrome is not
  ours to tint against.

## 0.1.1

### Patch Changes

- 062955f: Promote the mobile gateway to its own sidebar entry (above Settings) and make it on-demand only.

  - Move the mobile pairing surface out of Settings into a dedicated top-level **Mobile** view in the sidebar.
  - The gateway no longer auto-starts with the app — it stays off on every launch and is enabled explicitly per session (the persisted pairing token/identity are kept, so re-enabling reuses the same QR).
  - Tear the gateway down through its manager on quit so the end-to-end proxy tunnel is closed and the relay deregisters this machine — fixing the "unresponsive until you regenerate the code" pairing left behind by a leaked tunnel from the previous run.

## 0.1.0

### Minor Changes

- 358a565: Sidebar polish: workspace rows now carry a single color-tinted folder icon (replacing the grid glyph), row actions ([+] new session, ⋯ menu) are hover-only and overlay the right edge of the name with a gradient fade instead of reserving width — so workspace and session names use the full row when idle — and the sidebar widened 232px → 272px for readable first-prompt titles. desktop-ui gains a `folder` icon.

## 0.0.3

### Patch Changes

- d0e0bd2: Desktop workspaces now hold multiple sessions: desks persist a session list (v1 docs migrate so the first session keeps the desk's id and resumes its existing logs), the runner pool is keyed by session id (one `moxxy serve` per session), new `sessions.list/create/setActive/remove/rename` IPC commands (list/create/setActive/rename remote-allowed for mobile; remove host-only), and the sidebar shows the active desk's sessions with new/rename/delete affordances — `session.newSession` keeps its reset-current semantics. The desktop also gains dark mode (light/dark/system in Settings → Appearance, persisted in prefs, nativeTheme-synced, Clerk modals themed; designed `darkTokens` palette with CI-enforced light/dark parity), the workflow builder becomes a true infinite canvas (pan both axes unbounded, cursor-anchored zoom 10–400%, zoom-to-fit, persisted viewport), and self-update is honest about runner-protocol bumps: such releases report "requires full update" with a release-page link instead of staging a bundle the bootstrap would refuse and claiming success, update diagnostics explain boot-time refusals, and floor boots after a relaunch no longer inherit the previous override's identity.
