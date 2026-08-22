---
'@moxxy/cli': minor
'@moxxy/desktop': minor
---

Reading a page costs what changed, and a sequence of actions costs one read.

The whole accessibility tree on every read is what a heavy page cost: ~25,300
tokens for a Wikipedia article, ~9,700 for Canva's home page, almost all of it
identical to the read before because the agent had clicked one thing. One Canva
task came to 2.2 million tokens, nearly all of it re-sending a page that had
barely moved.

Two things were in the way, and both are now gone.

**uids meant a position, so nothing could be called unchanged.** They were handed
out by a counter in document order, so inserting one element renumbered
everything below it — measured on a Wikipedia article, one added element left 1%
of the rendered lines matching. Chromium's own accessibility node ids do not
move: after that same insertion, all 17,644 nodes carrying a DOM node kept
theirs and none changed. uids are now short labels minted against those and
remembered for the life of the document, so a uid means the same element read
after read. They survive the tree being handed back for being idle — measured
too: after `Accessibility.disable`, a detach and a re-attach, 1,636 nodes kept
their ids — and they are dropped when the page actually navigates, including a
navigation the person started by clicking a link.

**Every read sent the whole page.** After the first read of a tab, a read now
carries only what was removed, added or changed, keyed by uid so a row that
merely shifted down is not reported as a change. The comparison runs over the
rendered text, so it is exactly what would have been sent, with no second
implementation of the pruning rules to drift. `full: true` asks for the whole
tree when the changes alone are not enough. Measured: a Wikipedia article after
one element appears, 25,345 tokens down to 1,136.

**And `browser_batch`**, because the other half of the cost is one read per
action. It runs a sequence — click, type, press, navigate, go back — and reads
the page once at the end. Steps stop at the first failure and the error names
which step it was, so a sequence never carries on against a page that did not do
what was expected. One approval covers the whole thing and shows every step,
which is more informative than four prompts answered in a row.

Measured end to end: opening Canva and creating an Instagram post project went
from about 1.4 million tokens to 501 thousand.
