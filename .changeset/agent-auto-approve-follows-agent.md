---
'@moxxy/cli': patch
---

The auto-approve switch of a conversation on Claude or Codex follows the agent when its approvals change without Moxxy (another client, a hook, Claude changing its own mode): Claude reports the change in a status message and Codex in `thread/settings/updated`, and the switch shows it at once, in the middle of a turn too. Before, the switch kept showing the old state, and with auto-approve still shown on, Moxxy answered for the person an approval Codex asked because its thread had been set to ask. Moxxy's own changes, and how plan and goal mode run the agent, are not taken for such a change. OpenCode's auto-approve is Moxxy's own answering, which nothing outside Moxxy changes.
