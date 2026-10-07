---
'@moxxy/desktop': patch
---

The desktop release builds its update bundle again. The app's main imported the browser plugin's package root, which since the terminal browser profile also loads Playwright, so the whole of Playwright was built into the main and the update bundle was refused for importing packages it does not carry (`chromium-bidi` and others). The main now imports only the page host (`@moxxy/plugin-browser/host`), and every build checks the main's imports, so the next one fails its pull request instead of the release.
