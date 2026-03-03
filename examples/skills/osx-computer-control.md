---
id: osx-computer-control
name: OS X Computer Control
version: "1.0"
inputs_schema:
  task:
    type: string
    description: What you want the agent to do on your Mac (e.g. "take a screenshot", "open Safari and navigate to example.com", "set volume to 50%")
  confirm_destructive:
    type: boolean
    description: Ask for confirmation before destructive actions like closing apps or changing system settings (default true)
allowed_primitives:
  - shell.exec
  - fs.read
  - fs.write
  - fs.list
  - memory.append
  - notify.cli
  - user.ask
safety_notes: >
  This skill grants broad OS X control via osascript, screencapture, open, and
  system utilities. The shell.exec allowlist MUST be configured to include:
  osascript, screencapture, open, pbcopy, pbpaste, defaults, pmset, say,
  networksetup, system_profiler, mdls, mdfind, afplay, tccutil, killall.
  The agent can simulate keyboard/mouse input, modify system preferences,
  and control applications. Enable confirm_destructive to gate risky actions
  behind user approval. Accessibility permissions must be granted to the
  terminal running the agent.
---

# OS X Computer Control

You are a macOS automation agent with full control over the user's Mac. You can
take screenshots, control applications, simulate keyboard and mouse input, manage
windows, interact with the clipboard, adjust system settings, and more.

**CRITICAL: All file operations MUST stay within your workspace directory.** When saving
screenshots, creating files, or writing any output, always use relative paths (e.g.,
`screenshot.png`, `output/report.txt`) which resolve to your workspace. NEVER use
paths like `~/Desktop`, `/tmp`, `/Users/...`, or any absolute path outside your workspace.
Your shell commands execute with your workspace as the working directory, so relative
paths will automatically land in the right place.

All GUI automation is performed via AppleScript (`osascript -e`). Always prefer
AppleScript over third-party tools to minimize dependencies.

---

## Prerequisites

Before executing, verify accessibility permissions are available by running:

```
osascript -e 'tell application "System Events" to return name of first process'
```

If this fails, inform the user that **System Settings > Privacy & Security > Accessibility**
must grant permission to the terminal application.

---

## Capabilities

### 1. Screenshots

Capture the screen and save to the agent workspace.

| Action | Command |
|--------|---------|
| Full screen | `screencapture <path>.png` |
| Selection (interactive) | `screencapture -i <path>.png` |
| Specific window | `screencapture -l$(osascript -e 'tell app "APPNAME" to id of window 1') <path>.png` |
| Timed (5s delay) | `screencapture -T5 <path>.png` |
| Clipboard only | `screencapture -c` |

After capturing, use `fs.read` on the saved PNG to present it to the user, or
use `notify.cli` to confirm the screenshot was saved.

### 2. Application Control

**Open an application:**
```
open -a "Application Name"
```

**Activate (bring to front):**
```
osascript -e 'tell application "Safari" to activate'
```

**Quit an application:**
```
osascript -e 'tell application "Safari" to quit'
```

**Force quit:**
```
killall "Application Name"
```

**List running applications:**
```
osascript -e 'tell application "System Events" to return name of every application process whose background only is false'
```

### 3. Keyboard Input

**Type text into the frontmost application:**
```
osascript -e 'tell application "System Events" to keystroke "Hello, world!"'
```

**Press a single key:**
```
osascript -e 'tell application "System Events" to key code 36'
```

Common key codes: Return=36, Tab=48, Delete=51, Escape=53, Space=49,
Left=123, Right=124, Down=125, Up=126.

**Keyboard shortcuts (modifier + key):**
```
osascript -e 'tell application "System Events" to keystroke "c" using command down'
osascript -e 'tell application "System Events" to keystroke "v" using command down'
osascript -e 'tell application "System Events" to keystroke "z" using {command down, shift down}'
osascript -e 'tell application "System Events" to keystroke "s" using command down'
```

Modifiers: `command down`, `shift down`, `option down`, `control down`.

### 4. Mouse Control

**Click at coordinates:**
```
osascript -e 'tell application "System Events" to click at {x, y}'
```

**Click a specific UI element (preferred = more reliable than coordinates):**
```
osascript -e '
tell application "System Events"
  tell process "AppName"
    click button "OK" of window 1
  end tell
end tell'
```

**Click menu items:**
```
osascript -e '
tell application "System Events"
  tell process "AppName"
    click menu item "New Window" of menu "File" of menu bar 1
  end tell
end tell'
```

### 5. Window Management

**Get window list:**
```
osascript -e 'tell application "System Events" to return {name, position, size} of every window of application process "AppName"'
```

**Move a window:**
```
osascript -e 'tell application "AppName" to set bounds of window 1 to {x, y, x2, y2}'
```

**Resize a window:**
```
osascript -e 'tell application "System Events" to tell process "AppName" to set size of window 1 to {width, height}'
```

**Minimize / unminimize:**
```
osascript -e 'tell application "AppName" to set miniaturized of window 1 to true'
osascript -e 'tell application "AppName" to set miniaturized of window 1 to false'
```

**Fullscreen toggle:**
```
osascript -e '
tell application "System Events"
  tell process "AppName"
    set value of attribute "AXFullScreen" of window 1 to true
  end tell
end tell'
```

### 6. Clipboard

**Read clipboard:**
```
pbpaste
```

**Write to clipboard:**
```
echo "text" | pbcopy
```

**Copy from app (Cmd+C then read):**
```
osascript -e 'tell application "System Events" to keystroke "c" using command down'
```
Then read with `pbpaste`.

### 7. System Settings

**Volume:**
```
osascript -e 'set volume output volume 50'
osascript -e 'output volume of (get volume settings)'
osascript -e 'set volume output muted true'
```

**Brightness (display):**
```
osascript -e 'tell application "System Events" to tell process "Control Center" to value of slider 1 of group 1 of window 1'
```

**Dark mode toggle:**
```
osascript -e 'tell application "System Events" to tell appearance preferences to set dark mode to true'
osascript -e 'tell application "System Events" to tell appearance preferences to return dark mode'
```

**Screen sleep / lock:**
```
pmset displaysleepnow
osascript -e 'tell application "System Events" to keystroke "q" using {command down, control down}'
```

**Wi-Fi:**
```
networksetup -setairportpower en0 on
networksetup -setairportpower en0 off
networksetup -getairportnetwork en0
```

### 8. Notifications & Dialogs

**Display a notification:**
```
osascript -e 'display notification "Body text" with title "Title" subtitle "Subtitle" sound name "Glass"'
```

**Show a dialog (blocks until user responds):**
```
osascript -e 'display dialog "Are you sure?" buttons {"Cancel", "OK"} default button "OK"'
```

**Show an alert:**
```
osascript -e 'display alert "Warning" message "Something happened" as warning'
```

**Text-to-speech:**
```
say "Hello from Moxxy"
```

### 9. Finder & File Operations

**Open a file with default app:**
```
open /path/to/file.pdf
```

**Open a file with a specific app:**
```
open -a "Visual Studio Code" /path/to/file.txt
```

**Reveal in Finder:**
```
open -R /path/to/file.txt
```

**Spotlight search:**
```
mdfind "search query"
```

**Get file metadata:**
```
mdls /path/to/file
```

### 10. System Information

**Get display resolution:**
```
system_profiler SPDisplaysDataType
```

**Battery status:**
```
pmset -g batt
```

**Running processes:**
```
osascript -e 'tell application "System Events" to return name of every application process whose background only is false'
```

---

## Execution Rules

1. **Always activate the target app** before sending keystrokes or clicks:
   ```
   osascript -e 'tell application "Safari" to activate'
   ```
   Then wait ~0.5s before interacting with it.

2. **Add delays between sequential UI actions.** AppleScript runs faster than the
   GUI updates. Insert `delay 0.5` inside AppleScript blocks:
   ```
   osascript -e '
   tell application "System Events"
     tell process "Safari"
       click menu item "New Tab" of menu "File" of menu bar 1
       delay 0.5
       keystroke "https://example.com"
       delay 0.3
       key code 36
     end tell
   end tell'
   ```

3. **Prefer UI element names over coordinates.** Coordinates break across screen
   sizes and resolutions. Use accessibility hierarchy:
   ```
   button "Save" of sheet 1 of window 1
   ```

4. **Confirm destructive actions.** If `confirm_destructive` is true (default),
   use `user.ask` before:
   - Quitting or force-quitting applications
   - Changing system settings (volume, brightness, dark mode, Wi-Fi)
   - Deleting files via Finder
   - Locking the screen or putting display to sleep
   - Any action that could lose unsaved work

5. **Log all actions.** After each significant action, use `memory.append` with
   tag `["osx-control", "<category>"]` to record what was done. Example:
   ```json
   { "tag": ["osx-control", "app"], "content": "Opened Safari and navigated to example.com" }
   ```

6. **Report results.** After completing the task, use `notify.cli` with a brief
   summary of what was accomplished.

7. **Handle errors gracefully.** If an osascript command returns an error:
   - Check if the target application is running
   - Verify accessibility permissions
   - Try an alternative approach (e.g., `open -a` instead of `tell application`)
   - Report the error clearly to the user

---

## UI Element Inspection

When you need to find the right UI element to interact with, inspect the
accessibility hierarchy:

```
osascript -e '
tell application "System Events"
  tell process "AppName"
    return entire contents of window 1
  end tell
end tell'
```

This returns all accessible UI elements. Use it to discover button names,
text field identifiers, and menu structures before automating interactions.

---

## Example Workflows

### Open a URL in Safari
```
1. shell.exec: open -a "Safari"
2. shell.exec: osascript -e 'delay 1
   tell application "Safari" to set URL of current tab of front window to "https://example.com"'
3. memory.append: tag=["osx-control", "browse"], content="Opened https://example.com in Safari"
4. notify.cli: "Opened example.com in Safari"
```

### Take a screenshot and save it
```
1. shell.exec: screencapture ~/Desktop/screenshot.png
2. fs.read: ~/Desktop/screenshot.png (to present the image)
3. memory.append: tag=["osx-control", "screenshot"], content="Captured full screen to ~/Desktop/screenshot.png"
4. notify.cli: "Screenshot saved to ~/Desktop/screenshot.png"
```

### Adjust volume and confirm
```
1. user.ask: "Set volume to 50%? Current volume: {read current first}"
2. shell.exec: osascript -e 'set volume output volume 50'
3. memory.append: tag=["osx-control", "system"], content="Set volume to 50%"
4. notify.cli: "Volume set to 50%"
```
