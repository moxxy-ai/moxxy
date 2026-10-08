---
'@moxxy/desktop': patch
---

One click updates everything, with one restart and no questions. Update downloads the new app and restarts once; the app that comes back sets up its extensions, model connections and agent runtime before it starts, on one screen that shows each step and leaves by itself. The dialogs that asked about the OpenAI connections, extensions and Computer Use minutes after the start are gone: those packages install silently, the previous copy is kept, and a copy that had been changed by hand is mentioned once with where its backup is. The update banner appears only for a new app release; the runner and extensions follow the version the app was built with instead of the newest one on npm, so a package published before its desktop release no longer moves the app onto an untested runner or brings a second update. A step that fails stops the update with its reason and no restart, and the launch after a restart checks that the planned version is the one running. The installer built from this release accepts the next app update without a second full installer: it had been refusing updates made for its own runner.

An update that needs the full installer goes through the same button and the same screen. Windows and Linux no longer download an installer in the background at launch and install it on quit behind a system notification. When the system refuses the installer (an unsigned macOS build), the screen offers the release page to download it instead of only "Try again".

One backup of each app-managed package is kept instead of one per update: older copies are removed once the new one is in place, so the profile stops growing by a full copy of each connection with every release.

The app no longer asks for workflow approvals every two seconds while the agent runtime is still starting; each of those asks failed and was written to the log.
