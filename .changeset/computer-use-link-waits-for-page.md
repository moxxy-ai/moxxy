---
"@moxxy/cli": patch
---

Computer Use waits for a followed link's page: a click on a link to another page (or Return on one) waits up to 8 s until the page changes, and when it has not, the action says the page is still loading and a run stops instead of clicking the link again. A click that only lit an element up is no longer remembered as a step's element, and the skill tells the agent to answer "why did it fail" from what it sees, not a guess.
