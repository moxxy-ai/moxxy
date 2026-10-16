---
"@moxxy/cli": minor
"@moxxy/sdk": minor
---

A conversation on the Claude, Codex or OpenCode agent connection now lasts until you delete it. When the agent starts a new session of its own while the conversation already has turns (its earlier session is gone, or you switched agents partway), the session starts from Moxxy's record of the conversation: the latest turns word for word, a line for each older turn, and a note that this is history rather than a new request. Claude no longer fails every message of a conversation whose Claude session was cleared. `recall` now searches the whole conversation (`query`) and reads any turn by its number (`turn`), and the three agents get it, so a detail from long ago is still found. The SDK adds `AgentStepRequest.earlierConversation`, `renderEarlierConversation`, `searchConversation` and `conversationTurns`.

Codex now sees Moxxy's tools (`ask_user`, `recall`, the browser and the others it is lent): Codex reads the tool list once, as a thread opens or resumes, and Moxxy now has the list ready by then instead of only once the turn starts.
