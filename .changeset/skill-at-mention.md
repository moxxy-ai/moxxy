---
'@moxxy/sdk': minor
'@moxxy/cli': patch
'@moxxy/desktop': patch
---

`@skill-name` in a chat prompt calls that skill for the request, on every surface (desktop, terminal UI, channel bots, mobile): the skill rides on the prompt as an attachment, so every client and every replay sees it, and a prompt a trigger wrote calls nothing. Skills gain `aliases:` (other names to mention them by; `_` reads as `-`) and `disallowed-tools:` (tools withheld from a request that mentions the skill). `@computer_use` calls Computer Use and keeps Moxxy's in-window Browser out of that request; the browser skill no longer tells the agent to use the in-window Browser when the user names another browser such as Arc. The SDK exports `mentionedSkills`, `skillAttachment`, `withoutTools` and `toolPatternMatches`. In the desktop, typing `@` in the composer opens a menu of the tools a prompt can call (Computer Use and Moxxy Browser first, labelled by the skills' new `label:` field), narrowed as you type; arrows, Enter/Tab and Escape drive it, and `@moxxy_browser` keeps Computer Use out of its request. The SDK also exports `mentionQueryAt`, `mentionOptions` and `insertMention`, `SessionInfo.skills` carries each skill's description, label and aliases, and `@moxxy/client-core` has `useMentionPicker` for any composer.
