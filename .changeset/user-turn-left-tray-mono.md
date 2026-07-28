---
'@moxxy/desktop': minor
'@moxxy/desktop-ui': minor
---

Chat: a user turn now reads left-to-right like every other block, with an
avatar, a "You" label and an accent left rule instead of right-aligned text.
Right alignment only said whose turn it was while the turn was short: a pasted
prompt wrapped into a ragged-left column the eye had to re-find on every line.

Tray: the macOS menu bar gets the one-colour mark as a template image at 22px
and @2x, so AppKit tints it for the light and dark bar and for the menu-open
state. Windows and Linux keep the colour icon, since their tray chrome is not
ours to tint against.
