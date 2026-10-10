---
'@moxxy/cli': patch
---

Developer diagnostics in the browser need the site allowed before they record a page or read a response body, except on localhost and loopback addresses; credential-like fields (`jwt`, `csrf_token`, `auth_token`, `x-api-key`, `sessionid`, …) and JWT-shaped values are now masked wherever they appear.
