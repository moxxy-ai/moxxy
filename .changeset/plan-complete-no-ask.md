---
"@moxxy/sdk": patch
"@moxxy/cli": patch
---

Plan mode hands in the plan without asking for approval: a tool a mode offers only for its turn (`plan_complete`) now has its declared permission honoured, as the tool call carries the offered tool's rule to the resolver (`PermissionContext.toolPermission`). Standing deny rules still refuse it.
