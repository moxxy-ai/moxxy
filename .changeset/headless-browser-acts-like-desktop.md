---
'@moxxy/cli': patch
'@moxxy/desktop': patch
---

The browser in the terminal acts like the desktop's. `moxxy` outside the desktop now drives its headless browser through the same browser host as the desktop's pane, so `browser_type` replaces a field instead of appending, a press on a covered or disabled element is refused with the reason, a click reports the navigation, dialog or new tab it set off, and `browser_select`, `browser_scroll`, `browser_hover`, `browser_wait`, `browser_dialog`, `browser_point`, `browser_upload` and (with Jev) `browser_run` work there too. `browser_capture` and `browser_await_human`, which failed headless, now answer — the hand-off saying plainly that nobody can take over a browser with no window. Acting asks once per site (`browser_allow_site`) instead of before every click, as on the desktop.
