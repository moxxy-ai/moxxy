# Computer Control Skill (Host Proxy)

Use this skill to autonomously control the macOS computer you are running on.
This skill ferries your exact AppleScript down to the secure native Host Proxy which executes it on the User's root desktop.

## Usage
Provide the AppleScript code as the first argument.

```bash
computer_control 'tell application "Safari" to activate'
```

It will execute the script on the host machine and return the output or any compile errors. You can use this to visually manipulate the screen, fetch emails from the Mail app, or orchestrate anything else macOS supports.
