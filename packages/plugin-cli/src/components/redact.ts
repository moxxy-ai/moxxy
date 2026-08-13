/**
 * Secret redaction for any surface that echoes raw tool inputs to the terminal
 * (the permission prompt, the subagent activity panel).
 *
 * Re-exported from `@moxxy/sdk` rather than reimplemented here, so the TUI, the
 * audit trail, and anything else that displays or forwards tool input mask the
 * same things.
 *
 * This module used to carry a local, KEY-NAME-ONLY implementation, which left
 * the case that matters most wide open: a Bash call's `command` is not a
 * secret-named field, so the permission dialog printed
 * `curl -H "Authorization: Bearer sk-ant-…"` verbatim into scrollback. That is
 * precisely the string the dialog exists to show a human, and terminals get
 * recorded and screens get shared. The SDK version also matches secret-shaped
 * VALUES inside ordinary fields.
 */
export {
  isSecretKey,
  redactSecrets,
  redactSecretText,
  REDACTED_PLACEHOLDER,
} from '@moxxy/sdk';
