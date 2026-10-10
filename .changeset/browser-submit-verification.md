---
'@moxxy/cli': patch
'@moxxy/plugin-browser': patch
---

Verify typed browser form values before pressing Enter so a successfully submitted field clearing itself does not stop the remaining steps. Bind Enter to the typed field in single actions and batches, report uncertain submission without retrying, and recheck user takeover immediately before input, including selector-based filling. Reject read-only and non-text controls before sending input events and keep protected values out of typing replies. Repair native field-value reads and reuse their result without another full accessibility-tree read. Keep list-row context for unnamed controls and uniquely visible delete buttons in both runner trees and delta snapshots, excluding decorative subtree labels. Retain row labels as click or hover targets without confusing them with check/uncheck controls, and direct native double clicks to the UID tool and browser navigation to browser_history.

Recheck takeover before each next character, the second press of a double click, and text selection or bulk insertion after focus. Release the current key or mouse button while refusing further input, without additional browser reads or model requests.

Forward aborted browser calls to the backend with request-scoped cancellation. Stop queued sidecar work before dispatch and check cancellation between host input operations without closing the shared browser or cancelling unrelated calls.

Distinguish native Undo from Shift-modified Redo so browser editing shortcuts restore an undone edit instead of issuing Undo again.

Preserve multiline accessible names and field values in delta snapshots, escaping newlines and quotes so text cannot create fake element handles or hide edits after the first line. Retain the existing truncation and snapshot budgets.
