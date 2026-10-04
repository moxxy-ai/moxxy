---
'@moxxy/cli': patch
'@moxxy/desktop': patch
---

The agent's browser no longer stops at a page that only mentions a CAPTCHA — Coolify's list of services includes one called "Cap Captcha", and the agent asked you to clear a CAPTCHA that was not there. A CAPTCHA now counts only as its widget. A run of steps also finds cards a page answers clicks on without calling them buttons, such as the service cards in Coolify's catalogue, by the text they show.
