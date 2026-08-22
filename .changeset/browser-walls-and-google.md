---
'@moxxy/cli': minor
'@moxxy/desktop': minor
---

The browser searches with Google, and says when a page has stopped being
readable and started asking for a person.

Some pages are not pages any more: a cookie banner, a CAPTCHA, a sign-in form.
The agent must not clear any of them — the consent belongs to the user, the
CAPTCHA is theirs to solve, the password is theirs to type — and an agent that
presses "Accept all" on someone's behalf has made a decision nobody asked it to
make. Every acting tool is already permission-gated, so this is not the only
guard; it is the one that arrives before the model has to work out what it is
looking at from a pile of buttons. The snapshot now carries a `### Needs you`
section naming the wall and telling the agent to call `browser_await_human`
instead of clicking through it.

Detection reads the accessibility tree, not the prose: the words have to sit on
something pressable, so an article about cookies is still an article. Where a
page is several walls at once, the most blocking one is named — a sign-in behind
a CAPTCHA needs the CAPTCHA cleared first. The credential vocabulary is now
shared with the redactor rather than copied, because a security regex with two
copies is a security regex with two behaviours.

A new tab and a typed phrase now go to Google rather than DuckDuckGo. On a
profile that has never been there Google answers with the EU consent wall, which
is exactly the case above: the agent hands over, the user answers once, and the
persistent partition remembers it.
