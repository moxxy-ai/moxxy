---
'@moxxy/cli': patch
'@moxxy/desktop': minor
---

Moxxy Browser acts the way a person does and says what happened. A click brings the agent's tab to the front, scrolls to the element, refuses a disabled one or one something covers (naming what is in the way), moves the pointer there, checks the page felt the press, and waits for the page to settle; the result reports a navigation, a dialog or a tab the page opened. Typing replaces what a field held instead of appending, and `submit: true` presses Enter afterwards; Enter now submits forms. An `alert()` no longer takes the tab down — it is accepted and quoted — and a `confirm` or `prompt` waits for the new `browser_dialog`. New desktop tools pick from a native list (`browser_select`), scroll, hover and wait for text. Frames are read into the snapshot and can be acted on, from the same site and from others, and `target=_blank` links open as tabs in the pane rather than as a separate window. A footer link to a cookie policy, or a form with a password field among others, no longer stops the agent as if the page were asking the user for something. The terminal UI's headless browser keeps its tools as they were.
