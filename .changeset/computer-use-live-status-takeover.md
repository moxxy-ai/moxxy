---
'@moxxy/cli': patch
'@moxxy/sdk': minor
'@moxxy/desktop': patch
---

Computer Use status reaches every attached client as it changes, and the user can take over. The runner pushes a `computer.changed` notification (protocol 23) instead of being polled, the desktop forwards it to the chat, and the control strip names the app and window under control, shows the state as text with an icon, and offers Stop, Take over and Resume from the keyboard. Take over pauses the agent, lets go of any held key or button and hides the agent cursor until the user resumes. SDK: `ComputerControlService.subscribe` and the `takeover` control command.
