---
'@moxxy/cli': patch
'@moxxy/desktop': patch
---

The auto-approve switch of a conversation on Claude or Codex keeps to one rule when the agent's approvals change without Moxxy (another client, a hook, Claude changing its own mode): something outside Moxxy may only make the agent ask more, and only the person lets it act without asking. A change that makes the agent ask more is followed at once, in the middle of a turn too, and turns the switch off; a looser change made while the switch is off (Claude's bypass or auto mode; for Codex fewer approvals, a wider sandbox or its own reviewer in place of the person) is set back at once. Both show a note in the desktop conversation. Claude reports the change in a status message and Codex in `thread/settings/updated`. Before, the switch kept showing the old state, and with auto-approve still shown on, Moxxy answered for the person an approval Codex asked because its thread had been set to ask. Moxxy's own changes are not taken for such a change, and a Codex that was made to ask more is not loosened back on the next turn. OpenCode's auto-approve is Moxxy's own answering, which nothing outside Moxxy changes.
