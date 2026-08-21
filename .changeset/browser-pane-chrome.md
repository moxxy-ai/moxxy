---
'@moxxy/desktop': minor
---

Browser pane: a tab strip you can actually close tabs in, and chrome that
belongs to the rest of the app.

There was no way to close a tab. There is now one per tab — quiet until you
hover or tab onto it, so the strip is not a row of × marks, and never able to
leave you with zero tabs: closing the last one opens a fresh home tab rather
than an empty rectangle with an address bar.

The chrome was inline styles that happened to work; it is now built from the
same tokens and the same grammar as the workbench tabs above it. The tab row is
recessed and the active tab is lifted onto the toolbar's surface and merged with
it, the way a browser tab has always joined its toolbar — no second accent
underline a few pixels below the workbench's own, which is what made the two
rows compete. New-tab sits against the last tab instead of marooned at the far
edge, and stays reachable when the strip scrolls.

The toolbar's last button now takes a picture of the page and hands it to the
agent, arriving in the composer as an ordinary attachment chip named after the
site (`browser-canva.com.png`) — the same journey a pasted screenshot makes, so
it rides the same provenance and send pipeline rather than a second one. It
replaces a panel that dumped the accessibility tree the agent reads. How the
agent perceives a page is between the agent and the host; showing it to the
person was a debugging aid, not a feature, and `browser.snapshot` is gone from
the renderer's IPC surface with it.

The strip also stops lying. It was pushed only when a tab was added, removed or
selected, so a page that retitled or navigated itself left the strip naming
something that was no longer on screen — two tabs both labelled "DuckDuckGo"
while the second was showing example.com. Main now watches each adopted view
and pushes on title and navigation changes as well.
