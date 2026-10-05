---
'@moxxy/cli': patch
'@moxxy/desktop': patch
---

The agent's browser crops a capture to everything an element draws — padding and border too, and content that overflows an element with no size of its own (Canva's canvas in a narrow pane) — instead of a 0×0 picture; an element that draws nothing is an error that says so. A capture asked for a uid the page does not have says to leave the uid out for the whole viewport. A press no longer refuses a button as covered by what sat at its place before the page scrolled to it — the terminal's browser read the point as if the page had not scrolled, so a Google Form's "Prześlij" below the fold was "covered" by the textarea above it every time — nor when the page moved under it while it checked — a form field that grew as it was typed into pushed the button down, and the second look read the old place.
