# windows_control

Executes PowerShell code natively on the host Windows machine. Use for system info, app control, UI automation, clipboard access, and more.

## Usage

Provide the PowerShell code as the first argument.

```
windows_control 'Get-Process | Sort-Object CPU -Descending | Select-Object -First 10'
```

```
windows_control 'Start-Process notepad'
```

```
windows_control 'Get-Clipboard'
```

## Capabilities

- **System info**: `Get-ComputerInfo`, `Get-Process`, `Get-Service`, disk/memory/CPU
- **App control**: `Start-Process`, `Stop-Process`, window management via Win32 APIs
- **UI automation**: `Add-Type -AssemblyName System.Windows.Forms` for SendKeys, screen info
- **Clipboard**: `Get-Clipboard`, `Set-Clipboard`
- **File/registry**: `Get-ItemProperty`, `Get-ChildItem`
- **Networking**: `Test-NetConnection`, `Get-NetAdapter`

## Notes

- Requires Windows. Returns a clear error if invoked on macOS or Linux.
- The host proxy runs PowerShell with `-NoProfile -NonInteractive` for security.
- For multi-line scripts, use semicolons or newlines; escape quotes appropriately.
