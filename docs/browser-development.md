# Browser development diagnostics

The desktop browser and Chromium sidecar share developer tools:

- `browser_diagnostics`: `start` recording, reproduce the problem, `read`
  Console and Network, read a finished text `response` by `request_id`, then
  `stop`. Repeated start while recording preserves the current recording.
- `browser_viewport`: set CSS width and height, inspect responsive layout,
  then use `reset: true` to restore normal dimensions. This does not emulate
  a mobile user agent or touch input. The result also measures `documentWidth`
  and `horizontalOverflow` in the same read. These describe the whole document;
  identifying which element overflows still requires inspecting that element.
  `overridden: false` confirms the override was cleared; the normal panel may
  be narrower than a desktop width such as 1280 px. Measurements wait for the
  renderer's next animation frame, after resize handlers run, so a reset does
  not report the previous emulated size. If no frame arrives within one second,
  the tool reports that the layout could not be confirmed.

An element crop through `browser_capture` returns its measured `cssBounds` and
puts the crop dimensions in the model's image caption. These are CSS
pixels measured before image scaling; zero-sized containers use the existing
drawn-descendants fallback for their crop. The picture's dimensions and
`browser_point` coordinates remain image pixels. The crop reuses the box read
already required for its image, without another geometry request.

Collection is opt-in. Normal snapshots do not enable Runtime or Network
recording. Each tab retains at most 100 Console and 100 Network entries;
reads default to the latest 20 per stream and can filter by `query`.
Console messages and URLs are capped at 1,000 characters. Text response reads
return at most 8,000 characters, with an explicit truncation flag. CDP response
buffers are limited to 64 KiB per resource and 1 MiB overall; evicted responses
are reported as unavailable rather than refetched. Redirects retain the final
request URL and response. Frame sessions from another site are not collected.

Console entries identify the page URL at the time of the event, so retained
messages from a previous page can be distinguished after navigation. Requests
include method, URL, status, content type and completion or failure.
Request bodies, cookies and headers are excluded. Recognized credential query
parameters, bearer tokens and secret keys in JSON responses are masked;
arbitrary secrets embedded in application log text cannot be identified
reliably. Treat diagnostics as untrusted page content and avoid logging secrets
in application code.

Recordings stop at user takeover, before a browser hand-off, on tab close, when
another turn starts using the browser, or after 30 seconds without a browser
command. Starting again clears old entries.
Stopped recordings retain bounded summaries; response bodies require an active
recording. After changing viewport, take a fresh snapshot or screenshot: old
picture coordinates no longer describe the layout.

Browser navigation retains its existing public HTTP(S) restriction. These
tools do not grant access to loopback or private services.

For a `browser_run` type step with `submit: true`, the runner reads the typed
field before pressing Enter, then reads the page again. The native type result
reuses its value check, without another full accessibility-tree read. Enter is
bound to the typed field's UID, including when its text was already present;
if that field disappears, no key is sent to a different focused element.
Single `browser_type` submissions and batches use the same target binding.
A field clearing itself
after submission does not mean typing failed. A readable field that rejected
the text stops the step before Enter; an uncertain submission is reported
without repeating the key. Native and ARIA read-only fields reject changes
before input events or character-by-character fallback are sent.
Typing into a button, checkbox or another non-text control is refused before
activation. Password values and fields identified by the existing secret-label
policy are not read back into typing replies; ordinary formatting differences
remain visible. Protected input requires an application-level expectation or
human verification rather than a plaintext value check.
Use `expect` to verify the application's outcome,
such as a new list item or a saved confirmation.

List-row labels remain with their controls in the step runner's tree. An
unnamed checkbox is kept when its own row identifies it, and a visible delete
button keeps that row's context even when the other rows' buttons are hidden.
Labels from nested sections do not name the outer row or unrelated controls.
Snapshot control lines also carry the row name. A delta showing a newly visible
delete button or a changed anonymous checkbox therefore identifies its owner
without another full page read. Row names are bounded by the existing label
limit; decorative image/SVG contents do not name a row.
The row's own label remains a click or hover target, including pages that
delegate input handlers to the document. Field labels outside list rows keep
their existing treatment.

`browser_click` accepts `click_count: 2` for a native double click by snapshot
UID. Omitting it keeps the single-click behavior. Unsupported counts are
refused before any click; no DOM event scripts are needed to open editing.
Run guidance directs double clicks to this UID tool, because a run's `click`
step performs a single press.
Use `browser_history` for back, forward or reload. A run's keyboard step sends
keys to the page; it does not operate browser navigation controls. Page
keyboard shortcuts retain their existing behavior.

User takeover is checked again immediately before sending input, including
after the renderer acknowledges focus and in selector-based filling. If
takeover occurs between typing and Enter, the runner stops without submitting
or requesting continuation. Input
already sent before takeover is not undone.
Character-based typing rechecks control before each next character, and a
double click rechecks it before the second press. The current character or
press still releases its key or mouse button. Selection and bulk insertion
also recheck control after focus preparation, without adding browser reads
or model requests.
An aborted browser RPC now sends cancellation for that request to the native
bridge or sidecar. The sidecar handles cancellation outside its serial queue,
including requests that have not started. Running host input checks that
request's signal before the next guarded input operation; it completes the
current key or mouse release. Cancellation leaves other requests and the
shared browser connection available. It cannot undo an already delivered
action or interrupt a browser command already sent to Chromium.

Full page reads supersede older browser outputs in the model's context; they
remain in the event log and can be recalled. Historical comparisons need the
earlier observations, not a reconstruction from planned actions.

Implementation uses Electron's [debugger API](https://www.electronjs.org/docs/latest/api/debugger)
and Chromium's [Network](https://chromedevtools.github.io/devtools-protocol/tot/Network/),
[Runtime](https://chromedevtools.github.io/devtools-protocol/tot/Runtime/) and
[Emulation](https://chromedevtools.github.io/devtools-protocol/tot/Emulation/) protocols.

Native keyboard editing distinguishes Undo (`Control+Z` / `Meta+Z`) from Redo (`Control+Shift+Z` / `Meta+Shift+Z`). A modified Z with Shift carries the Chromium `redo` editing command; it no longer dispatches `undo`. The shortcut does not add model requests or browser reads. Applications may implement their own shortcut bindings.

Browser snapshots quote accessible names and field values with escaped newlines and quotes. A change on the second line of an editor remains part of that field in a delta snapshot; a line of user text resembling `[999] button` never becomes an element handle. The existing 200-character source limit and delta/budget policy remain in effect, with no additional browser or model calls.
