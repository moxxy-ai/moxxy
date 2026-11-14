---
'@moxxy/client-core': patch
'@moxxy/desktop': patch
---

First run no longer flashes a "Step 2 of 2" line while the runtime is set up in the background. A step that starts to apply behind the one a person is on is not counted, so the form stays still and a click lands where it was aimed.
