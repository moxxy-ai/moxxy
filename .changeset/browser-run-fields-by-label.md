---
'@moxxy/cli': patch
'@moxxy/desktop': patch
---

A run of browser steps types into the field you meant on forms whose labels are not tied to their fields, such as Coolify's service settings, where it had typed a domain into Description instead of Domains. A typed step is now checked on the field itself, only steps whose effect was seen are remembered for next time, and a button with no name is no longer picked blindly.
