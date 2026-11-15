---
'@moxxy/sdk': patch
'@moxxy/chat-model': patch
'@moxxy/channel-kit': patch
'@moxxy/mode-goal': patch
'@moxxy/desktop': patch
---

A met goal shows its list of steps as done. An agent can end its goal before it ticks the last step of its list, which left "Goal complete" next to "2 of 3 done" with a step still in progress. Once the goal is met, every step it left in progress or waiting shows as done, on the desktop, in the terminal and in Discord and Telegram; a step it cancelled stays cancelled, and a paused goal leaves the list as it was.
