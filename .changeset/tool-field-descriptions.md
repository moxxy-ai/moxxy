---
'@moxxy/sdk': minor
'@moxxy/desktop': patch
---

Tool parameter descriptions now reach the model.

`zodToJsonSchema` dropped every `.describe()` on the floor, so a field
documented as "omit for the active tab" arrived at the provider as a bare
`{"type":"string"}`. The model had nothing to go on and invented values —
observed live as `tab_id: "current"` against a browser that names its tabs
`t1`, `t2`. Descriptions are now carried through to the JSON schema, including
from under `.optional()`, `.default()` and `.refine()` wrappers; where a wrapper
and the type it wraps both carry one, the outermost wins.

This affects every tool in every plugin: any `.describe()` written against a
field is now text the model actually reads. Nothing else about the emitted
schema changes.

Desktop: readiness-waits for a workspace runner shared one pool subscription
instead of attaching one listener each. A dozen workspaces used to push the
runner pool past Node's default listener cap and print a
MaxListenersExceededWarning on every launch, which then hid any genuine
listener leak behind known noise.
