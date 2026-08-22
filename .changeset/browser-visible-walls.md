---
'@moxxy/cli': patch
'@moxxy/desktop': patch
---

A page only counts as waiting on a person when there is something real to press —
and the person is shown it before they are asked.

The wall detector reads the accessibility tree, which is enough to spot a
consent button or a password field and not enough to know either is drawn. A
control can sit in the tree without being on screen — hidden by opacity, moved
away by a transform, inside a collapsed container, or simply left behind after
the banner it belonged to was dismissed. Reported as a wall, one of those traps
the agent in a hand-off nobody can answer: the person is told to press something
they cannot see, presses Done because there is nothing to do, and the next read
says exactly the same thing.

Seen live on canva.com, where the agent asked three times running for a cookie
choice the user could not find. The banner had been real earlier in the session
and was gone by the time they looked.

`detectWall` now names the node it matched, and the callers — which do have
geometry — check something is actually laid out for it before believing it. Both
backends do this: the desktop through `DOM.getBoxModel`, the sidecar through the
point lookup it already uses to decide whether a uid can be clicked.
`formatSnapshot` no longer decides for itself; it renders what it is told,
because telling a wall from a control that merely exists needs more than the tree
it is given.

A box is layout, not visibility — an element far down the page has a perfectly
good one — and that is on purpose: a consent banner below the fold is still a
real wall. Being *shown* it is a separate job, and it belongs to the hand-off.
Raising one now brings its tab to the front, scrolls to the control, and asks the
page whether the element actually landed in view. When it did not, the banner
says so and tells the person to go looking, rather than asking them to press
something that is not on their screen — which is precisely how a hand-off turns
into a loop: press Done, nothing changed, asked again.

Also settled while chasing this: the pane's `<webview>` is not taller than its
container. A capture of the guest viewport matches what the pane shows — so the
suspicion recorded in the previous commit was wrong, and pages with something
fixed to the bottom are fine.

The pattern that decides what a consent control looks like was too loose. It
matched bare stems — `akceptuj`, `więcej opcji` — and Canva's account menu is
called "Więcej opcji konta i zespołu", so every snapshot of a logged-in Canva
reported a consent wall that was not there. The agent, trusting the section,
asked the user to answer a cookie banner that did not exist; pressing Done
changed nothing, so it asked again. Three times, over an hour, before the
hand-off banner started naming the control it had found — at which point the
account menu identified itself in one screenshot.

A control now counts as consent if its label mentions cookies, or uses a phrase
that appears nowhere but a consent banner. Over-matching here is not a small
cost: it sends the person looking for something that is not there.

The hand-off banner names the control from now on. It is the difference between
"I cannot see it" and "I am looking at the wrong thing", and it turned an hour of
guessing into one screenshot.
