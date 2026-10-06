---
'@moxxy/cli': patch
---

Computer Use (macOS helper): typing, keys, paste and text selection work while the app stays in the background. Text is inserted at the caret through accessibility (replacing a selection), or typed as key events sent only to the target app, stopping and reporting how much was typed if keyboard focus moves. Keys and chords are sent to the app alone, never to the app the user is working in; Command-A selects all through accessibility, while other Command shortcuts, which only an app in front handles, are refused with a hint instead of being lost. Plain text and Markdown paste without touching the clipboard; rich-text paste uses the clipboard and gives the user's clipboard back unless they copied something meanwhile. select_text finds text by content, asks for prefix or suffix when it repeats, and never reads password fields. The host now sends helpers chords already parsed from xdotool syntax.
