---
'@moxxy/desktop-host': patch
'@moxxy/desktop': patch
---

Desktop permission sheet: the answers now do what they say. "Allow once" lets one call run and the next call of the tool asks again; the new "Allow for session" lets the tool run without asking for the rest of the conversation (also across turns), and a new conversation (`/new`) starts with no such grant; "Always allow" still persists a rule. Before, the desktop never remembered a session answer, so the sheet came back for every call. The phone app's "Allow session" goes through the same path and now works too. The four answers carry hints naming the tool and fit the focus window's toast without being cut.
