/**
 * Platform-aware helpers for shell profile instructions.
 */
import { platform } from 'node:os';

/**
 * Returns a shell instruction to export an environment variable.
 * - Unix: `export NAME="value"`
 * - Windows: `[Environment]::SetEnvironmentVariable("NAME", "value", "User")`
 */
export function shellExportInstruction(name, value) {
  if (platform() === 'win32') {
    return `[Environment]::SetEnvironmentVariable("${name}", "${value}", "User")`;
  }
  return `export ${name}="${value}"`;
}

/**
 * Returns a shell instruction to unset an environment variable.
 * - Unix: `unset NAME`
 * - Windows: `[Environment]::SetEnvironmentVariable("NAME", $null, "User")`
 */
export function shellUnsetInstruction(name) {
  if (platform() === 'win32') {
    return `[Environment]::SetEnvironmentVariable("${name}", $null, "User")`;
  }
  return `unset ${name}`;
}

/**
 * Returns the name of the shell profile file for the current platform.
 * - Unix: `~/.zshrc or ~/.bashrc`
 * - Windows: `PowerShell $PROFILE`
 */
export function shellProfileName() {
  if (platform() === 'win32') {
    return 'PowerShell $PROFILE';
  }
  return '~/.zshrc or ~/.bashrc';
}
